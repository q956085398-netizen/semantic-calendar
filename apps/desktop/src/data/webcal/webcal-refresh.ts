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

import { parseIcsCalendar, type IcsParseIssue } from "../../ics/parse-ics";
import { normalizeEventForStorage } from "../../normalize/normalizer";
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

export type WebcalRefreshStatus = "updated" | "not-modified" | "failed";

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
}

export interface WebcalAddOutcome {
  /** 地址非法时为 undefined，此时不会创建来源。 */
  sourceId?: string;
  /** 创建 / 更新后的来源最终形态。 */
  source?: CalendarSource;
  error?: string;
  refresh?: WebcalRefreshOutcome;
}

export interface WebcalDeps {
  now?: () => Date;
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
): Promise<WebcalAddOutcome> {
  const normalized = normalizeWebcalUrl(input.url);
  if (!normalized.ok) {
    return { error: WEBCAL_URL_ERROR_MESSAGES[normalized.error] };
  }

  const sourceId = sourceIdForWebcalUrl(normalized.url);
  const existing = store.getSource(sourceId);

  // 重复添加同一地址命中同一来源：保留用户已做的启停选择，只刷新地址。
  const source: CalendarSource = existing
    ? { ...existing, webcal: { ...existing.webcal, url: normalized.url } }
    : {
        id: sourceId,
        type: WEBCAL_SOURCE_TYPE,
        name: webcalDisplayName(normalized.url),
        enabled: true,
        lastSyncStatus: "never",
        webcal: { url: normalized.url },
      };
  store.upsertSource(source);

  const refresh = await refreshWebcalSource(store, sourceId, http, deps);
  return { sourceId, source: store.getSource(sourceId), refresh };
}

/** 同一来源的并发刷新共用一次请求，避免重复下载（§12）。 */
const inFlightByStore = new WeakMap<
  CalendarStore,
  Map<string, Promise<WebcalRefreshOutcome>>
>();

export function refreshWebcalSource(
  store: CalendarStore,
  sourceId: string,
  http: HttpIO,
  deps: WebcalDeps = {},
): Promise<WebcalRefreshOutcome> {
  let inFlight = inFlightByStore.get(store);
  if (inFlight === undefined) {
    inFlight = new Map();
    inFlightByStore.set(store, inFlight);
  }

  const running = inFlight.get(sourceId);
  if (running !== undefined) {
    return running;
  }

  const task = performRefresh(store, sourceId, http, deps).finally(() => {
    inFlight.delete(sourceId);
  });
  inFlight.set(sourceId, task);
  return task;
}

async function performRefresh(
  store: CalendarStore,
  sourceId: string,
  http: HttpIO,
  deps: WebcalDeps,
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
    response = await http.get({
      url: cache.url,
      etag: cache.etag,
      lastModified: cache.lastModified,
    });
  } catch (error) {
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
  if (store.getSource(sourceId) === undefined) {
    return failed(sourceId, "订阅已删除，结果已丢弃");
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

  const parsed = parseIcsCalendar(response.body ?? "");
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
  if (parsed.events.length === 0 && store.listEvents(sourceId).length > 0) {
    return markFailed(
      store,
      sourceId,
      cache,
      checkedAt,
      "订阅内容为空，已保留本地缓存",
    );
  }

  const { inserted, updated, removed } = store.replaceSourceEvents(
    sourceId,
    parsed.events.map((event) =>
      normalizeEventForStorage({ ...event, sourceId }),
    ),
  );
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
