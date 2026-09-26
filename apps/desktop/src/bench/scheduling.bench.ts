// @vitest-environment node
/**
 * 基线：让出主线程的机制开销（SC-020）。
 *
 * 分片读取（calendar/month-occurrences）与分片增强（semantic/enrich）都把长
 * 计算拆成若干短任务，任务之间用 scheduling/yield-to-main 让出。这个开销决定
 * 了“拆开”值不值：如果一次让出比一片计算还贵，分片就只是把卡顿换成了更慢。
 * 这里把它单独测出来，与 month.bench.ts 的单任务耗时一起读。
 */

import { bench, describe } from "vitest";
import { yieldToMain } from "../scheduling/yield-to-main";

describe("调度 · 让出主线程", () => {
  bench(
    "一次让出",
    async () => {
      await yieldToMain();
    },
    { iterations: 20, warmupIterations: 2, time: 0 },
  );

  bench(
    "连续 20 次让出",
    async () => {
      for (let index = 0; index < 20; index += 1) {
        await yieldToMain();
      }
    },
    { iterations: 10, warmupIterations: 1, time: 0 },
  );
});
