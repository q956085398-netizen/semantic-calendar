/**
 * WebCal 订阅的添加与刷新（SC-007 / SRC-002 / SRC-003 / SRC-004）。
 *
 * 链路：条件 GET →（304 用缓存 / 200 解析）→ 标准化 → 按 UID 替换落库
 * → 更新来源状态与缓存校验值。落盘由调用方统一执行（与其他写操作共用
 * 一次原子写），与本仓库既有导入服务的约定一致。
 *
 * 可靠性约定：
 * - 任何失败（网络、超时、HTTP 错误、内容无法解析、空内容）都只标记状态，
 *   不删除已有事件（§13 网络失败：显示缓存、标记失败、不删旧数据）；
 * - lastSyncAt 只在成功时推进，失败时保留上次成功时间（SRC-003）；
 * - 错误文案经过脱敏，URL token 不落库、不进日志（§14）；
 * - 同一来源的并发刷新合并为一次请求（§12：避免不必要的重复下载）。
 */

import {
  parseIcsCalendarInChunks,
  type IcsParseIssue,
} from "../../ics/parse-ics";
import { normalizeEventsInChunks } from "../../normalize/normalizer";
import {
  runYielding,
  type RunYieldingDeps,
} from "../../scheduling/run-yielding";
import {
  WEBCAL_SOURCE_TYPE,
  type CalendarSource,
  type WebcalCache,
} from "../model";
import type { CalendarStore } from "../store/calendar-store";
import type { HttpIO } from "../net/http-io";
import {
  WEBCAL_URL_ERROR_MESSAGES,
  describeRedactedError,
  normalizeWebcalUrl,
  sourceIdForWebcalUrl,
  webcalDisplayName,
} from "./webcal-url";

export type WebcalRefreshStatus =
  "updated" | "not-modified" | "failed" | "cancelled";

export interface WebcalRefreshOutcome {
  sourceId: string;
  status: WebcalRefreshStatus;
  inserted: number;
  updated: number;
  removed: number;
  /** 因解析错误被跳过的 VEVENT 数（事件级隔离，ICS-005）。 */
  skipped: number;
  issues: IcsParseIssue[];
  /** 失败原因，已脱敏，可直接展示给用户。 */
  error?: string;
}

export interface WebcalAddInput {
  url: string;
  /** 用户自定义的显示名称；省略时保留既有名称。 */
  name?: string;
}

export interface WebcalAddOutcome {
  /** 地址非法时为 undefined，此时不会创建来源。 */
  sourceId?: string;
  /** 创建 / 更新后的来源最终形态。 */
  source?: CalendarSource;
  error?: string;
  refresh?: WebcalRefreshOutcome;
}

export interface WebcalRefreshContext {
  signal: AbortSignal;
  isCurrent: () => boolean;
}

export interface WebcalDeps {
  /** 订阅状态时钟（lastCheckedAt）；与分片时钟同名不同义，因此不整体透传。 */
  now?: () => Date;
  /** 任务之间让出主线程的方式；只供测试注入（见 scheduling/run-yielding）。 */
  yieldToMain?: () => Promise<void>;
  /** 让出阈值；只供测试注入更小的值。 */
  yieldAfterMs?: number;
  /**
   * 事件粒度（标准化与替换共用，与本地导入同一口径）；
   * 只供测试注入更小的值，0 表示不切片（一次算完）。
   */
  eventsPerChunk?: number;
}

export interface WebcalRefreshOptions {
  /** 后台操作会在停用来源时取消；手动刷新保持现有行为。 */
  background?: boolean;
  /** 200 刷新后的工作也属于这次刷新，来源删除时一并取消。 */
  afterUpdated?: (context: WebcalRefreshContext) => Promise<void>;
}

/** 分片注入项：字段名与 WebcalDeps 的 `now` 冲突，逐项映射而不是整体透传。 */
function sliceOptions(deps: WebcalDeps, signal: AbortSignal): RunYieldingDeps {
  return {
    yieldToMain: deps.yieldToMain,
    yieldAfterMs: deps.yieldAfterMs,
    signal,
  };
}

/**
 * 添加订阅并立即抓取一次。
 *
 * 抓取失败不会回滚来源：用户需要看到它、修正或删除它，
 * 而不是让一次网络抖动抹掉刚输入的地址（§13）。
 */
export async function addWebcalSubscription(
  store: CalendarStore,
  input: WebcalAddInput,
  http: HttpIO,
  deps: WebcalDeps = {},
  options: WebcalRefreshOptions = {},
): Promise<WebcalAddOutcome> {
  const normalized = normalizeWebcalUrl(input.url);
  if (!normalized.ok) {
    return { error: WEBCAL_URL_ERROR_MESSAGES[normalized.error] };
  }

  const sourceId = sourceIdForWebcalUrl(normalized.url);
  const existing = store.getSource(sourceId);
  const name = input.name?.trim();

  // 重复添加同一地址命中同一来源：保留用户已做的启停选择，只刷新地址。
  const source: CalendarSource = existing
    ? {
        ...existing,
        ...(name ? { name } : {}),
        webcal: { ...existing.webcal, url: normalized.url },
      }
    : {
        id: sourceId,
        type: WEBCAL_SOURCE_TYPE,
        name: name || webcalDisplayName(normalized.url),
        enabled: true,
        lastSyncStatus: "never",
        webcal: { url: normalized.url },
      };
  store.upsertSource(source);

  const refresh = await refreshWebcalSource(
    store,
    sourceId,
    http,
    deps,
    options,
  );
  return { sourceId, source: store.getSource(sourceId), refresh };
}

/** 同一来源的并发刷新共用一次请求，避免重复下载（§12）。 */
interface ActiveRefresh {
  controller: AbortController;
  background: boolean;
  /** 事件已提交后的增强与保存必须完成，避免持久化半成品。 */
  finalizing: boolean;
  promise: Promise<WebcalRefreshOutcome>;
}

const activeRefreshesByStore = new WeakMap<
  CalendarStore,
  Map<string, ActiveRefresh>
>();

function activeRefreshesFor(store: CalendarStore): Map<string, ActiveRefresh> {
  let active = activeRefreshesByStore.get(store);
  if (!active) {
    active = new Map();
    activeRefreshesByStore.set(store, active);
  }
  return active;
}

export function refreshWebcalSource(
  store: CalendarStore,
  sourceId: string,
  http: HttpIO,
  deps: WebcalDeps = {},
  options: WebcalRefreshOptions = {},
): Promise<WebcalRefreshOutcome> {
  const active = activeRefreshesFor(store);
  const running = active.get(sourceId);
  if (running && !running.controller.signal.aborted) {
    // 前台手动操作加入后台刷新时，停用来源不能再中止这次明确请求。
    if (!options.background) running.background = false;
    return running.promise;
  }

  const operation: ActiveRefresh = {
    controller: new AbortController(),
    background: options.background === true,
    finalizing: false,
    promise: Promise.resolve(cancelled(sourceId)),
  };
  active.set(sourceId, operation);
  const isCurrent = () =>
    active.get(sourceId) === operation &&
    store.getSource(sourceId) !== undefined;
  operation.promise = Promise.resolve()
    .then(() =>
      performRefresh(
        store,
        sourceId,
        http,
        deps,
        operation.controller.signal,
        isCurrent,
      ),
    )
    .then(async (result) => {
      if (result.status !== "updated" || options.afterUpdated === undefined) {
        return result;
      }
      operation.finalizing = true;
      await options.afterUpdated({
        signal: operation.controller.signal,
        isCurrent,
      });
      return operation.controller.signal.aborted || !isCurrent()
        ? cancelled(sourceId)
        : result;
    })
    .catch((error: unknown) => {
      if (
        operation.controller.signal.aborted ||
        isAbortError(error) ||
        !isCurrent()
      ) {
        return cancelled(sourceId);
      }
      throw error;
    })
    .finally(() => {
      if (isCurrent()) active.delete(sourceId);
    });
  return operation.promise;
}

/** 删除来源前使其请求与所有尚未完成的分片失效，再级联清理存储数据。 */
export function removeWebcalSubscription(
  store: CalendarStore,
  sourceId: string,
): void {
  const active = activeRefreshesByStore.get(store);
  const operation = active?.get(sourceId);
  if (operation) {
    active?.delete(sourceId);
    operation.controller.abort();
  }
  store.removeSource(sourceId);
}

/** 停用来源只取消后台刷新；用户明确发起的手动刷新继续完成。 */
export function cancelBackgroundWebcalRefresh(
  store: CalendarStore,
  sourceId: string,
): void {
  const active = activeRefreshesByStore.get(store);
  const operation = active?.get(sourceId);
  if (!operation?.background || operation.finalizing) return;
  active?.delete(sourceId);
  operation.controller.abort();
}

/** 关闭 App 时终止所有在途刷新与分片工作。 */
export function cancelAllWebcalRefreshes(store: CalendarStore): void {
  const active = activeRefreshesByStore.get(store);
  if (!active) return;
  for (const operation of active.values()) operation.controller.abort();
  active.clear();
}

async function performRefresh(
  store: CalendarStore,
  sourceId: string,
  http: HttpIO,
  deps: WebcalDeps,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<WebcalRefreshOutcome> {
  const now = deps.now ?? (() => new Date());
  const source = store.getSource(sourceId);

  if (source === undefined) {
    return failed(sourceId, "订阅不存在或已被删除");
  }
  const cache = source.webcal;
  if (source.type !== WEBCAL_SOURCE_TYPE || cache === undefined) {
    return failed(sourceId, "该来源不是 WebCal 订阅");
  }

  const checkedAt = now().toISOString();

  let response;
  try {
    response = await http.get(
      {
        url: cache.url,
        etag: cache.etag,
        lastModified: cache.lastModified,
      },
      signal,
    );
  } catch (error) {
    if (signal.aborted || isAbortError(error) || !isCurrent()) {
      return cancelled(sourceId);
    }
    return markFailed(
      store,
      sourceId,
      cache,
      checkedAt,
      `网络请求失败：${describeRedactedError(error, cache.url)}`,
    );
  }

  // 抓取期间来源可能已被删除（用户点了删除）：此时写入会留下无主的
  // 事件记录，永远不再显示，也不再被任何来源管理。
  if (!isCurrent()) {
    return cancelled(sourceId);
  }

  if (response.notModified) {
    // 缓存仍然有效：事件不变，但这仍是一次成功的刷新。
    store.updateSourceStatus(sourceId, {
      lastSyncStatus: "ok",
      lastSyncAt: checkedAt,
    });
    store.setSourceCache(sourceId, { ...cache, lastCheckedAt: checkedAt });
    return outcome(sourceId, "not-modified");
  }

  if (response.status < 200 || response.status >= 300) {
    return markFailed(
      store,
      sourceId,
      cache,
      checkedAt,
      `订阅地址返回 HTTP ${response.status}`,
    );
  }

  const parsed = await runYielding(
    parseIcsCalendarInChunks(response.body ?? ""),
    sliceOptions(deps, signal),
  );
  if (!isCurrent() || signal.aborted) return cancelled(sourceId);
  const skipped = parsed.issues.filter(
    (issue) => issue.eventIndex !== undefined,
  ).length;
  const fileIssue = parsed.issues.find(
    (issue) => issue.eventIndex === undefined,
  );
  if (parsed.events.length === 0 && fileIssue !== undefined) {
    return markFailed(
      store,
      sourceId,
      cache,
      checkedAt,
      `订阅内容无法解析：${fileIssue.message}`,
    );
  }

  // 空日历（合法但没有 VEVENT）在已有缓存时按失败处理：服务端维护页 /
  // 中间代理返回的“空壳”与真正清空的订阅无法区分，而清空事件的代价
  // 远高于保留一份可能过期的缓存（P-01 可靠性优先 / §13 不删除旧数据）。
  // 只判定有无，不读整份事件（`listEvents()` 会逐条克隆，见 SC-024）。
  if (parsed.events.length === 0 && store.hasEvents(sourceId)) {
    return markFailed(
      store,
      sourceId,
      cache,
      checkedAt,
      "订阅内容为空，已保留本地缓存",
    );
  }

  // 与本地导入同一组分片原语（SC-024）：标准化与按批次替换各自分片，
  // 10,000 条的订阅刷新因此也不再整段占着主线程（性能文档 §3.5）。
  const stored = await runYielding(
    normalizeEventsInChunks(parsed.events, sourceId, deps.eventsPerChunk),
    sliceOptions(deps, signal),
  );
  if (!isCurrent() || signal.aborted) return cancelled(sourceId);
  const { inserted, updated, removed } = await runYielding(
    store.replaceSourceEventsInChunks(
      sourceId,
      stored,
      deps.eventsPerChunk,
      () => isCurrent() && !signal.aborted,
    ),
    sliceOptions(deps, signal),
  );
  if (!isCurrent() || signal.aborted) return cancelled(sourceId);
  store.updateSourceStatus(sourceId, {
    lastSyncStatus: "ok",
    lastSyncAt: checkedAt,
  });
  // 校验值随本次响应整体替换：服务端不再返回时必须清掉旧值，
  // 否则会一直用过期 ETag 发出条件请求而拿不到新内容。
  store.setSourceCache(sourceId, {
    url: cache.url,
    etag: response.etag,
    lastModified: response.lastModified,
    lastCheckedAt: checkedAt,
  });

  return outcome(sourceId, "updated", {
    inserted,
    updated,
    removed,
    skipped,
    issues: parsed.issues,
  });
}

/** 失败路径统一出口：标记状态与最近尝试时间，事件与上次成功时间保持不动。 */
function markFailed(
  store: CalendarStore,
  sourceId: string,
  cache: WebcalCache,
  checkedAt: string,
  error: string,
): WebcalRefreshOutcome {
  store.updateSourceStatus(sourceId, {
    lastSyncStatus: "error",
    lastSyncError: error,
  });
  store.setSourceCache(sourceId, { ...cache, lastCheckedAt: checkedAt });
  return failed(sourceId, error);
}

function failed(sourceId: string, error: string): WebcalRefreshOutcome {
  return outcome(sourceId, "failed", { error });
}

function cancelled(sourceId: string): WebcalRefreshOutcome {
  return outcome(sourceId, "cancelled");
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function outcome(
  sourceId: string,
  status: WebcalRefreshStatus,
  patch: Partial<WebcalRefreshOutcome> = {},
): WebcalRefreshOutcome {
  return {
    sourceId,
    status,
    inserted: 0,
    updated: 0,
    removed: 0,
    skipped: 0,
    issues: [],
    ...patch,
  };
}
