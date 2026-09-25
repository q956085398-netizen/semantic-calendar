import { describe, expect, it } from "vitest";
import { createTimeSlicedRun } from "./time-sliced";

/**
 * 时间分片执行器（SC-020）：把长计算拆成短任务的那一半。
 *
 * 被测的是执行方式而不是结果——结果由各自的生成器负责（月视图读取见
 * calendar/month-occurrences.test.ts，提醒计划见 notifications/reminder-plan-load.test.ts）。
 */

/** 生成器：每片推进 step 次，共 pieces 片，最后返回累计值。 */
function* countingSteps(
  pieces: number,
  step = 1,
): Generator<void, number, void> {
  let done = 0;
  for (let index = 0; index < pieces; index += 1) {
    done += step;
    if (index + 1 < pieces) {
      yield;
    }
  }
  return done;
}

describe("createTimeSlicedRun — 分片执行（SC-020）", () => {
  it("一次任务可以跑完（不需要让出时不空转）", () => {
    const run = createTimeSlicedRun(countingSteps(3));

    expect(run.advance()).toBe(false);
    expect(run.hasWork()).toBe(false);
    expect(run.result()).toBe(3);
    // 已算完后再调用不会重跑生成器。
    expect(run.advance()).toBe(false);
    expect(run.result()).toBe(3);
  });

  it("越过阈值即返回，剩余工作留给下一次（阈值是软的：多跑一片）", () => {
    // 注入的时钟每读一次前进 1ms：任务里的片数因此有确定上界
    // （阈值 + 起始读 + 越界读）。
    let clockReads = 0;
    const run = createTimeSlicedRun(countingSteps(20), {
      now: () => {
        clockReads += 1;
        return clockReads;
      },
      yieldAfterMs: 3,
    });

    expect(run.advance()).toBe(true);
    expect(run.hasWork()).toBe(true);
    expect(run.result()).toBeUndefined();
    expect(clockReads).toBeLessThanOrEqual(3 + 2);

    // 排空后结果与一次跑完相同。
    let guard = 0;
    while (run.hasWork()) {
      run.advance();
      guard += 1;
      if (guard > 1000) {
        throw new Error("分片没有收敛");
      }
    }
    expect(run.result()).toBe(20);
  });

  it("阈值取默认值 5 ms（与文档同一个来源）", () => {
    // 用真实时钟：20 片、每片只是几次加法，必然在阈值内跑完。
    const run = createTimeSlicedRun(countingSteps(20));
    expect(run.advance()).toBe(false);
    expect(run.result()).toBe(20);
  });
});
