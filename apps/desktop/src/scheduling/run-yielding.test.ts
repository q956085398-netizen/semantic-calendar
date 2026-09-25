// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runYielding } from "./run-yielding";

/**
 * 分片生成器的让出驱动（SC-024）：被测的是执行方式（让出几次、什么时候让出），
 * 结果的正确性由各自的分片生成器负责。
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

describe("runYielding — 分片生成器的让出驱动（SC-024）", () => {
  it("结果与一次排空相同", async () => {
    await expect(
      runYielding(countingSteps(20, 3), {
        // 每次读时钟都前进 1ms：强制分多次任务。
        now: (() => {
          let reads = 0;
          return () => {
            reads += 1;
            return reads;
          };
        })(),
        yieldAfterMs: 2,
      }),
    ).resolves.toBe(60);
  });

  it("数据在小规模下一次算完：不需要让出时不空转", async () => {
    let yields = 0;
    const result = await runYielding(countingSteps(3), {
      // 阈值之内：第一个任务就排空。
      now: () => 0,
      yieldToMain: async () => {
        yields += 1;
      },
    });

    expect(result).toBe(3);
    expect(yields).toBe(0);
  });

  it("越过让出阈值后按任务推进，并在任务之间让出主线程", async () => {
    let yields = 0;
    let clock = 0;
    const result = await runYielding(countingSteps(10), {
      // 一次任务只够跑一片（片段各消耗 1ms，阈值 1ms）。
      now: () => {
        clock += 1;
        return clock;
      },
      yieldAfterMs: 1,
      yieldToMain: async () => {
        yields += 1;
        // 阈值是软的：一次任务 = 阈值 + 一片，因此让出次数少于片数。
        expect(clock).toBeGreaterThan(0);
      },
    });

    expect(result).toBe(10);
    expect(yields).toBeGreaterThan(0);
    expect(yields).toBeLessThan(10);
  });
});
