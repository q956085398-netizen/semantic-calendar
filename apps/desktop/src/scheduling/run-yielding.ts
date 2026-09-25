/**
 * 分片生成器的让出驱动（SC-024）：把一个分片生成器跑到完成，任务之间让出主线程。
 *
 * `scheduling/time-sliced.ts` 只负责「一个任务跑多远」，让出时机属于调用方；
 * 这里补上「按时间分片 + 让出 + 再推进」这条共同的调用循环。三条本来各自
 * 手写这个循环的路径（导入链路、订阅刷新、快照序列化）因此共用一个实现。
 *
 * 不持有定时器、不缓存结果：生成器排空即返回，中途不发布半份结果——
 * 结果由调用方在排空后一次性发布（App 的事件读取见 data/store/enriched-events-load.ts）。
 */

import { createTimeSlicedRun, type TimeSlicedDeps } from "./time-sliced";
import { yieldToMain as defaultYieldToMain } from "./yield-to-main";

export interface RunYieldingDeps extends TimeSlicedDeps {
  /** 任务之间让出主线程的方式；缺省用 MessageChannel 任务（见 scheduling/）。 */
  yieldToMain?: () => Promise<void>;
}

export async function runYielding<T>(
  steps: Generator<void, T, void>,
  deps: RunYieldingDeps = {},
): Promise<T> {
  const run = createTimeSlicedRun(steps, deps);
  const yieldToMain = deps.yieldToMain ?? defaultYieldToMain;

  // 第一个任务与调用方同一帧：常见规模一次算完，界面不会先空一下再填上。
  run.advance();
  while (run.hasWork()) {
    await yieldToMain();
    run.advance();
  }
  // hasWork() 为 false 即 result() 已有值（createTimeSlicedRun 的约定）。
  return run.result()!;
}
