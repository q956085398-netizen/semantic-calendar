/**
 * WebCal 低频后台刷新调度（SC-007 / app-spec §12）。
 *
 * 约束来自 §12：允许的后台触发是「应用启动、手动刷新、到达刷新时间」，
 * 明确避免高频轮询。因此这里不用 setInterval：
 * - 只维护一个 setTimeout，指向“最近一个到期时刻”，触发后重新计算；
 * - 没有到期的订阅时完全不持有定时器（空闲即零 CPU）；
 * - 同一时刻只跑一轮刷新，运行中不重入。
 *
 * 失败来源按更短的间隔重试（§12：可失败重试），而不是等到下一个常规周期。
 * 调度只读来源状态，不写任何数据；写库与落盘仍由刷新服务与调用方负责。
 *
 * 常规间隔是用户设置（SC-018 / 键 webcal.refreshIntervalMinutes），以供应商
 * 形式注入：调度器只在计算时读取，设置改动后 reschedule() 即可生效，
 * 不需要重建调度器。缺省值仍是 6 小时基线（SC-007 的行为不变）。
 */

import { WEBCAL_SOURCE_TYPE, type CalendarSource } from "../model";

/** 常规刷新间隔的缺省值：6 小时。 */
export const WEBCAL_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 上次失败后的重试间隔：30 分钟，与常规间隔设置无关（失败来源要更快恢复）。 */
export const WEBCAL_RETRY_INTERVAL_MS = 30 * 60 * 1000;

/** setTimeout 的延迟上限（2^31-1），超出会被截断成立即触发。 */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/**
 * 下一次应刷新的时刻（epoch ms）；不参与调度的来源返回 null。
 * intervalMs 为常规间隔（用户设置），失败来源仍按固定重试间隔计算。
 */
export function webcalDueAt(
  source: CalendarSource,
  nowMs: number,
  intervalMs: number = WEBCAL_REFRESH_INTERVAL_MS,
): number | null {
  if (
    source.type !== WEBCAL_SOURCE_TYPE ||
    !source.enabled ||
    source.webcal === undefined
  ) {
    return null;
  }
  const interval =
    source.lastSyncStatus === "error" ? WEBCAL_RETRY_INTERVAL_MS : intervalMs;

  const lastAttempt = source.webcal.lastCheckedAt ?? source.lastSyncAt;
  if (lastAttempt === undefined) {
    // 从未抓取过（例如刚导入的数据文件）：立即可刷新。
    return nowMs;
  }
  const lastMs = Date.parse(lastAttempt);
  if (Number.isNaN(lastMs)) {
    // 时间戳损坏时宁可刷新一次，也不要永久卡在“不需要刷新”。
    return nowMs;
  }
  return lastMs + interval;
}

/** 当前已到期的来源 id，按来源列表顺序（顺序由调用方的来源排序决定）。 */
export function dueWebcalSourceIds(
  sources: readonly CalendarSource[],
  nowMs: number,
  intervalMs?: number,
): string[] {
  return sources
    .filter((source) => {
      const dueAt = webcalDueAt(source, nowMs, intervalMs);
      return dueAt !== null && dueAt <= nowMs;
    })
    .map((source) => source.id);
}

/** 距离最近一次到期的毫秒数；没有任何到期计划时返回 null。 */
export function nextWebcalRefreshDelay(
  sources: readonly CalendarSource[],
  nowMs: number,
  intervalMs?: number,
): number | null {
  const dueTimes = sources
    .map((source) => webcalDueAt(source, nowMs, intervalMs))
    .filter((dueAt): dueAt is number => dueAt !== null);
  if (dueTimes.length === 0) {
    return null;
  }
  return Math.max(0, Math.min(...dueTimes) - nowMs);
}

export type TimerHandle = ReturnType<typeof setTimeout>;

export interface WebcalSchedulerDeps {
  /** 读取当前来源状态：调度每次重新计算，不缓存快照。 */
  listSources: () => CalendarSource[];
  refresh: (sourceId: string) => Promise<unknown>;
  /**
   * 读取常规刷新间隔（用户设置）；缺省用 6 小时基线。
   * 每次调度都重新读取，因此设置改动后只要 reschedule() 就生效。
   */
  intervalMs?: () => number;
  now?: () => number;
  setTimer?: (handler: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  /** 单个来源刷新失败不应中断整轮调度，错误交给这里留痕。 */
  onError?: (error: unknown, sourceId: string) => void;
}

export interface WebcalRefreshScheduler {
  start(): void;
  stop(): void;
  /** 手动刷新 / 增删订阅后调用，让下一次计划基于最新状态。 */
  reschedule(): void;
}

export function createWebcalScheduler(
  deps: WebcalSchedulerDeps,
): WebcalRefreshScheduler {
  const now = deps.now ?? (() => Date.now());
  const intervalMs = deps.intervalMs ?? (() => WEBCAL_REFRESH_INTERVAL_MS);
  const setTimer =
    deps.setTimer ?? ((handler, delayMs) => setTimeout(handler, delayMs));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));

  let timer: TimerHandle | undefined;
  let running = false;
  let stopped = true;

  function schedule(): void {
    if (stopped) {
      return;
    }
    if (timer !== undefined) {
      clearTimer(timer);
      timer = undefined;
    }
    const delay = nextWebcalRefreshDelay(
      deps.listSources(),
      now(),
      intervalMs(),
    );
    if (delay === null) {
      return;
    }
    timer = setTimer(
      () => {
        timer = undefined;
        void runDue();
      },
      Math.min(delay, MAX_TIMER_DELAY_MS),
    );
  }

  async function runDue(): Promise<void> {
    // 运行中不重入：一轮刷新可能跨越多个到期时刻。
    if (stopped || running) {
      return;
    }
    running = true;
    try {
      for (const sourceId of dueWebcalSourceIds(
        deps.listSources(),
        now(),
        intervalMs(),
      )) {
        if (stopped) {
          return;
        }
        try {
          await deps.refresh(sourceId);
        } catch (error) {
          deps.onError?.(error, sourceId);
        }
      }
    } finally {
      running = false;
      schedule();
    }
  }

  return {
    start() {
      stopped = false;
      schedule();
    },
    stop() {
      stopped = true;
      if (timer !== undefined) {
        clearTimer(timer);
        timer = undefined;
      }
    },
    reschedule() {
      schedule();
    },
  };
}
