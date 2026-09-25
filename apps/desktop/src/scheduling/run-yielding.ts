/**
 * 分片生成器的让出驱动（SC-024）：把一个分片生成器跑到完成，任务之间让出主线程。
 *
 * `scheduling/time-sliced.ts` 只负责「一个任务跑多远」，让出时机属于调用方；
 * 这里补上「按时间分片 + 让出 + 再推进」这条共同的调用循环。**同步入口 = `drain()`
 * 的一次排空**（见 scheduling/drain.ts），两条入口的结果逐条相同。
 *
 * 用它的调用方：导入链路（`data/import/import-local-ics.ts`）、订阅刷新的 200
 * 分支（`data/webcal/webcal-refresh.ts`）、快照落盘（`CalendarStore.save`）、
 * 界面的事件读取（`App.tsx` 的 refreshFromStore）。三处**没有**硬套过来，因为
 * 让出时机不同：语义增强按条数让出（每 500 条一次，与时间阈值无关）、月视图读取
 * 在渲染期先跑第一个任务（小日历首帧即完整月格）、提醒计划的重建带取消判据
 * （更晚的重建发起时，这次要在下一次让出后退出）。
 *
 * 不持有定时器、不缓存结果：生成器排空即返回，中途不发布半份结果——结果由调用方
 * 在排空后一次性发布（界面的事件读取见 data/store/enriched-events-load.ts）。
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
