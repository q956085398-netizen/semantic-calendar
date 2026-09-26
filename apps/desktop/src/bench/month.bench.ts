// @vitest-environment node
/**
 * 基线：月切换（app-spec §15「月切换耗时」）。
 *
 * 一次月切换在读取路径上做四件事：建网格 → 在可见窗口内展开重复规则
 * → 按日期分桶 → 取农历 / 节假日 / 节日节气载荷。这里按阶段分开测：
 * 合在一起只能看到一个总数，无法判断该优化哪一段。
 */

import path from "node:path";
import { afterAll, beforeAll, bench, describe } from "vitest";
import { bucketEventsByDateKey } from "../calendar/event-buckets";
import { buildMonthGrid } from "../calendar/month-grid";
import { createMonthOccurrenceLoad } from "../calendar/month-occurrences";
import type { CalendarSource, EnrichedEvent } from "../data/model";
import { CalendarStore } from "../data/store/calendar-store";
import { NodeFileIO } from "../data/store/node-file-io";
import { expandEventOccurrences } from "../normalize/occurrences";
import { chinaDayLabelsOf } from "../semantic/app-china-days";
import { chinaSemanticLabelsOf } from "../semantic/app-china-festivals";
import { lunarLabelsOf } from "../semantic/app-lunar";
import { EVENT_COUNTS, buildStoredEvents, monthWindow } from "./fixtures";
import { createTempDir, removeTempDir } from "./support";

const SOURCE: CalendarSource = {
  id: "local-ics:perf",
  type: "local-ics",
  name: "perf.ics",
  enabled: true,
};

/** 固定视图月份：10 月同时含国庆连休与多个节气，是载荷最重的一格。 */
const VIEW = { year: 2026, month: 10 };

let dir = "";
beforeAll(async () => {
  dir = await createTempDir();
});
afterAll(async () => {
  await removeTempDir(dir);
});

const visibleEvents = new Map<number, EnrichedEvent[]>();
/** 展开结果在测量之外算好：describe 体在 beforeAll 之前执行，不能在那里读存储。 */
const occurrencesByCount = new Map<number, EnrichedEvent[]>();
const grid = buildMonthGrid({ ...VIEW, today: `${VIEW.year}-10-01` });
const cells = grid.weeks.flat();
const window = monthWindow(VIEW.year, VIEW.month);

beforeAll(async () => {
  for (const count of EVENT_COUNTS) {
    const { store } = await CalendarStore.open(
      new NodeFileIO(),
      path.join(dir, `month-${count}.json`),
    );
    store.upsertSource(SOURCE);
    store.upsertEvents(SOURCE.id, buildStoredEvents(count, SOURCE.id));
    visibleEvents.set(count, store.listEnrichedEvents());
  }
});

beforeAll(() => {
  for (const count of EVENT_COUNTS) {
    occurrencesByCount.set(
      count,
      expandEventOccurrences(visibleEvents.get(count) ?? [], window),
    );
  }
});

describe("月切换 · 建网格", () => {
  bench(
    "42 格",
    () => {
      buildMonthGrid({ ...VIEW, today: `${VIEW.year}-10-01` });
    },
    { iterations: 10, warmupIterations: 1, time: 0 },
  );
});

describe("月切换 · 展开重复规则（可见窗口内）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `${count} 条事件`,
      () => {
        expandEventOccurrences(visibleEvents.get(count) ?? [], window);
      },
      { iterations: 5, warmupIterations: 1, time: 0 },
    );
  }
});

describe("月切换 · 按日期分桶", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `${count} 条事件的 occurrence`,
      () => {
        bucketEventsByDateKey(occurrencesByCount.get(count) ?? []);
      },
      { iterations: 5, warmupIterations: 1, time: 0 },
    );
  }
});

describe("月切换 · 日级语义载荷（农历 / 节假日 / 节日节气）", () => {
  bench(
    "42 格",
    () => {
      lunarLabelsOf(cells);
      chinaDayLabelsOf(cells);
      chinaSemanticLabelsOf(cells);
    },
    { iterations: 10, warmupIterations: 1, time: 0 },
  );
});

/**
 * 分片读取（SC-020）：这里只测**单次任务**——主线程上最长的那一段，也是
 * 「大量事件不阻塞 UI 线程」这条验收的对象。整段总时长刻意不在这里测：
 * 同一份基线里同步 / 分片两条对照行的差值在两次运行间是 +2.5% 与 −39%，
 * 测量抖动（±40%）比被测差异大，引用它只会得出错误结论（performance.md §3.3）。
 */
describe("月切换 · 分片读取（SC-020：单次任务不越过让出阈值）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `第一个任务 · ${count} 条事件`,
      () => {
        createMonthOccurrenceLoad({
          events: visibleEvents.get(count) ?? [],
          window,
        }).advance();
      },
      { iterations: 5, warmupIterations: 1, time: 0 },
    );
  }
});
