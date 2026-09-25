/**
 * 时间分片执行器（SC-020 / app-spec §15「大量事件不应阻塞 UI 线程」）。
 *
 * 把一个「跑一段长计算」的生成器拆成若干短任务：一个任务连续推进到越过让出
 * 阈值就返回，调用方（React 侧）在任务之间让出主线程。同步入口就是一次排空，
 * 因此分片只改变执行方式，不改变结果。
 *
 * 只做执行器该做的事：不持有定时器、不自己让出主线程、不缓存结果。让出时机与
 * 让出方式都属于调用方，因此它可以同步调用、可测试，也不存在悬空的异步循环。
 * 月视图读取（calendar/month-occurrences）与提醒计划重建
 * （notifications/reminder-plan-load）共用这一份实现。
 */

/**
 * 让出阈值（ms）：一个任务连续算满这么久就让出主线程。
 *
 * 名字刻意不叫「预算 / 上限」——它是**软阈值**：时间检查发生在每一片之后，
 * 因此一次任务 = 阈值 + 一片。取 5 ms 而不是一帧（16.7 ms），是给「片比预期
 * 慢」留余量。实测（performance.md §3.3）：一次任务 6.3–6.6 ms，最坏（末次
 * 任务还要多做一次分桶）约 14 ms，都在一帧以内。
 */
export const YIELD_AFTER_MS = 5;

export interface TimeSlicedDeps {
  /** 读时钟；只供测试注入确定性时钟。 */
  now?: () => number;
  /** 让出阈值；只供测试注入更小的值。 */
  yieldAfterMs?: number;
}

export interface TimeSlicedRun<T> {
  /** 算完后的结果；还没算完时为 undefined。 */
  result(): T | undefined;
  /** 还有未完成的片。 */
  hasWork(): boolean;
  /**
   * 跑一个任务：连续推进直到算完或越过让出阈值。
   * 返回是否还有剩余工作——调用方据此决定要不要让出主线程后再来一次。
   */
  advance(): boolean;
}

export function createTimeSlicedRun<T>(
  steps: Generator<void, T, void>,
  deps: TimeSlicedDeps = {},
): TimeSlicedRun<T> {
  const now = deps.now ?? defaultNow;
  const yieldAfterMs = deps.yieldAfterMs ?? YIELD_AFTER_MS;
  let result: T | undefined;

  return {
    result(): T | undefined {
      return result;
    },
    hasWork(): boolean {
      return result === undefined;
    },
    advance(): boolean {
      if (result !== undefined) {
        return false;
      }
      const taskStart = now();
      // 先跑一片再问时间：阈值再小也至少有进展，不会空转。
      for (;;) {
        const step = steps.next();
        if (step.done) {
          result = step.value;
          return false;
        }
        if (now() - taskStart >= yieldAfterMs) {
          return true;
        }
      }
    },
  };
}

function defaultNow(): number {
  return performance.now();
}
