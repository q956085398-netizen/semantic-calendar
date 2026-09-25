// @vitest-environment node
/**
 * 基线：导入链路的分片（SC-024 / app-spec §15「大量事件不应阻塞 UI 线程」）。
 *
 * 这里只测**单次任务**——主线程上最长的那一段，也是这条验收的对象
 * （「导入 10,000 条事件时主线程上没有超过一帧的任务」）。整段总时长刻意不在这
 * 里测：让出次数由每个任务的让出阈值决定，总时长的抖动比被测差异大（与月切换
 * §3.3 同一取舍）；整条链路的总时长仍在 import.bench.ts，按同步入口测量，
 * 与 SC-020 的基线行可比。
 *
 * 各段用 `advance()` 跑**第一个任务**：时间检查在每片之后，因此任何一个任务都是
 * 「阈值 + 一片」的形状，第一个任务代表除末次任务（多做一次拼接 / 过滤）之外的
 * 任何一个任务；末次任务与整条动作的全局最长实测数字记在 performance.md §3.5。
 */

import path from "node:path";
import { afterAll, beforeAll, bench, describe } from "vitest";
import { CalendarStore } from "../data/store/calendar-store";
import { NodeFileIO } from "../data/store/node-file-io";
import { parseIcsCalendarInChunks } from "../ics/parse-ics";
import { normalizeEventsInChunks } from "../normalize/normalizer";
import { createTimeSlicedRun } from "../scheduling/time-sliced";
import { EVENT_COUNTS, buildIcsFixture, buildStoredEvents } from "./fixtures";
import { createTempDir, removeTempDir } from "./support";

const SOURCE = {
  id: "local-ics:perf",
  type: "local-ics",
  name: "perf.ics",
  enabled: true,
} as const;

let dir = "";
beforeAll(async () => {
  dir = await createTempDir();
});
afterAll(async () => {
  await removeTempDir(dir);
});

/** 固定输入在测量之外生成：基准里不应包含夹具构造。 */
const ICS_BY_COUNT = new Map(
  EVENT_COUNTS.map((count) => [count, buildIcsFixture(count)] as const),
);
/** 解析产物（同步排空一次，供标准化段使用）。 */
const PARSED_BY_COUNT = new Map(
  EVENT_COUNTS.map(
    (count) =>
      [
        count,
        parseIcsCalendarInChunks(ICS_BY_COUNT.get(count) ?? "", 0, 0),
      ] as const,
  ),
);
const PARSED_EVENTS_BY_COUNT = new Map(
  EVENT_COUNTS.map((count) => {
    const steps = PARSED_BY_COUNT.get(count)!;
    let step = steps.next();
    while (!step.done) {
      step = steps.next();
    }
    return [count, step.value.events] as const;
  }),
);
/** 入库事件（落库段的输入）：夹具构造不进测量。 */
const STORED_BY_COUNT = new Map(
  EVENT_COUNTS.map(
    (count) => [count, buildStoredEvents(count, SOURCE.id)] as const,
  ),
);

/** 已播种的存储：单次任务测量不该把播种算进去。 */
const storeByCount = new Map<number, CalendarStore>();

beforeAll(async () => {
  for (const count of EVENT_COUNTS) {
    const { store } = await CalendarStore.open(
      new NodeFileIO(),
      path.join(dir, `slices-${count}.json`),
    );
    store.upsertSource(SOURCE);
    store.upsertEvents(SOURCE.id, STORED_BY_COUNT.get(count) ?? []);
    storeByCount.set(count, store);
  }
});

describe("导入 · 解析：单次任务（128 块一片）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `${count} 条`,
      () => {
        createTimeSlicedRun(
          parseIcsCalendarInChunks(ICS_BY_COUNT.get(count) ?? ""),
        ).advance();
      },
      { iterations: 5, warmupIterations: 1, time: 0 },
    );
  }
});

describe("导入 · 标准化：单次任务（128 条一片）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `${count} 条`,
      () => {
        createTimeSlicedRun(
          normalizeEventsInChunks(
            PARSED_EVENTS_BY_COUNT.get(count) ?? [],
            SOURCE.id,
          ),
        ).advance();
      },
      { iterations: 5, warmupIterations: 1, time: 0 },
    );
  }
});

describe("导入 · 落库：单次任务（128 条一片）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `${count} 条`,
      () => {
        createTimeSlicedRun(
          storeByCount
            .get(count)!
            .upsertEventsInChunks(SOURCE.id, STORED_BY_COUNT.get(count) ?? []),
        ).advance();
      },
      { iterations: 5, warmupIterations: 1, time: 0 },
    );
  }
});

describe("导入 · 快照序列化：单次任务（128 项一片）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `${count} 条`,
      () => {
        createTimeSlicedRun(
          storeByCount.get(count)!.snapshotJsonInChunks(),
        ).advance();
      },
      { iterations: 5, warmupIterations: 1, time: 0 },
    );
  }
});

describe("导入 · 事件读取：单次任务（128 条一片，逐条克隆）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `${count} 条`,
      () => {
        createTimeSlicedRun(
          storeByCount.get(count)!.listEnrichedEventsInChunks(),
        ).advance();
      },
      { iterations: 5, warmupIterations: 1, time: 0 },
    );
  }
});
