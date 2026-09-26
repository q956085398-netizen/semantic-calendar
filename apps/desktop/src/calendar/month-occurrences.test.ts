import { describe, expect, it } from "vitest";
import { asNormalizedEvent, type EnrichedEvent } from "../data/model";
import { buildStoredEvents } from "../bench/fixtures";
import { expandEventOccurrences } from "../normalize/occurrences";
import { bucketEventsByDateKey } from "./event-buckets";
import { buildMonthGrid } from "./month-grid";
import {
  createMonthOccurrenceLoad,
  monthOccurrencePendingText,
  occurrenceWindowOf,
} from "./month-occurrences";

/**
 * SC-020 读取路径接缝：月切换的展开要能分片让出主线程，且结果与同步入口
 * 逐条相同。预期值一律与 `bucketEventsByDateKey(expandEventOccurrences(…))`
 * 对照——分片只是执行方式，不是第二套语义。
 */

const VIEW = { year: 2026, month: 10 };
const GRID = buildMonthGrid({ ...VIEW, today: "2026-10-01" });
const WINDOW = occurrenceWindowOf(GRID);

function makeEvent(partial: Partial<EnrichedEvent>): EnrichedEvent {
  return {
    uid: "event@example.com",
    sourceId: "local-ics:test",
    title: "测试事件",
    start: "2026-10-01T09:00:00",
    allDay: false,
    normalizedTitle: "测试事件",
    ...partial,
  };
}

/** 含三趟扫描各自的形态：重复 master、取消 / 改期例外、孤儿例外、窗口外事件。 */
function mixedEvents(): EnrichedEvent[] {
  return [
    makeEvent({ uid: "plain", start: "2026-10-05T09:00:00" }),
    makeEvent({
      uid: "weekly",
      start: "2026-09-30T09:00:00",
      recurrence: { rrule: "FREQ=WEEKLY;COUNT=8", exdates: [] },
    }),
    makeEvent({
      uid: "weekly",
      start: "2026-10-14T15:00:00",
      occurrenceId: "2026-10-14T09:00:00",
    }),
    makeEvent({
      uid: "weekly",
      start: "2026-10-21T09:00:00",
      occurrenceId: "2026-10-21T09:00:00",
      cancelled: true,
    }),
    makeEvent({
      uid: "orphan",
      start: "2026-10-20T10:00:00",
      occurrenceId: "2026-10-20T10:00:00",
    }),
    makeEvent({ uid: "outside", start: "2026-12-01T09:00:00" }),
  ];
}

/** 参考实现：同步展开 + 分桶（改动前 App 的读取路径）。 */
function syncBuckets(events: EnrichedEvent[]): Map<string, EnrichedEvent[]> {
  return bucketEventsByDateKey(expandEventOccurrences(events, WINDOW));
}

function drain(load: ReturnType<typeof createMonthOccurrenceLoad>): number {
  let tasks = 0;
  while (load.hasWork()) {
    load.advance();
    tasks += 1;
    if (tasks > 100_000) {
      throw new Error("分片没有收敛");
    }
  }
  return tasks;
}

describe("createMonthOccurrenceLoad — 分片展开（SC-020）", () => {
  it("分片结果与同步路径逐条相同（含例外与孤儿例外）", () => {
    const events = mixedEvents();
    const load = createMonthOccurrenceLoad({ events, window: WINDOW });
    drain(load);

    expect(load.result().buckets).toEqual(syncBuckets(events));
    expect(load.result().pending).toBe(false);
  });

  it("常见规模在第一个任务里就算完：不会进入整理状态", () => {
    const events = mixedEvents();
    const load = createMonthOccurrenceLoad({ events, window: WINDOW });

    // 第一个任务返回 false = 没有剩余工作，界面首帧就能拿到完整月格。
    expect(load.advance()).toBe(false);
    expect(load.result().pending).toBe(false);
    expect(load.result().buckets).toEqual(syncBuckets(events));
  });

  it("大数据量第一个任务不完成：整理中不给出半份结果", () => {
    const events = buildStoredEvents(3_000, "local-ics:perf").map(
      asNormalizedEvent,
    );
    const load = createMonthOccurrenceLoad({ events, window: WINDOW });

    expect(load.advance()).toBe(true);
    expect(load.result().pending).toBe(true);
    // 未算完时给的是空 Map，而不是“算了一半”的事件——月格不会显示
    // 一个随后还会变的月（界面用状态行说明为什么暂时是空的）。
    expect(load.result().buckets.size).toBe(0);

    drain(load);
    expect(load.result().buckets).toEqual(syncBuckets(events));
  });

  it("单个任务受让出阈值约束：越过阈值即返回，剩余工作留给下一次", () => {
    // 注入的时钟每读一次前进 1ms：任务里的分片数因此有确定上界
    // （阈值 + 分片粒度决定的那一片）。
    let clockReads = 0;
    const load = createMonthOccurrenceLoad(
      {
        events: buildStoredEvents(200, "local-ics:perf").map(asNormalizedEvent),
        window: WINDOW,
      },
      {
        now: () => {
          clockReads += 1;
          return clockReads;
        },
        yieldAfterMs: 3,
        chunkEvents: 1,
      },
    );

    expect(load.advance()).toBe(true);
    // 每次分片后读一次时钟；越过阈值的那一片之后立即返回，因此读取次数
    // 最多是阈值 + 起始读 + 越界读。
    expect(clockReads).toBeLessThanOrEqual(3 + 2);

    drain(load);
    expect(load.result().pending).toBe(false);
  });
});

describe("occurrenceWindowOf — 网格覆盖的窗口", () => {
  it("含前后补格：从首格到末格（与展开口径一致）", () => {
    const lastWeek = GRID.weeks[GRID.weeks.length - 1];
    expect(WINDOW).toEqual({
      from: GRID.weeks[0][0].dateKey,
      to: lastWeek[lastWeek.length - 1].dateKey,
    });
  });
});

describe("monthOccurrencePendingText — 整理中的说法（§13）", () => {
  it("说明正在做什么与工作量，条数带千分位", () => {
    expect(monthOccurrencePendingText(10_000)).toBe(
      "正在整理事件（10,000 条）…",
    );
    expect(monthOccurrencePendingText(12)).toBe("正在整理事件（12 条）…");
  });
});
