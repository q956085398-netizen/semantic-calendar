import { describe, expect, it } from "vitest";
import type { EnrichedEvent } from "../data/model";
import { bucketEventsByDateKey, eventDateKeys } from "./event-buckets";
import { todayKeyFromDate } from "./month-grid";

/**
 * SC-006：事件 → 月格日期键的分桶规则。
 *
 * 断言刻意使用全天与浮动本地时间（无时区换算），保证在任意运行时区下
 * 都确定；UTC 事件按本地日期落格是预期语义（当地几点开始就落当地哪天）。
 */

function makeEvent(overrides: Partial<EnrichedEvent> = {}): EnrichedEvent {
  return {
    uid: "event-1@example.com",
    sourceId: "local-ics:test",
    title: "测试事件",
    start: "2026-10-08T19:00:00",
    allDay: false,
    normalizedTitle: "测试事件",
    ...overrides,
  };
}

describe("eventDateKeys", () => {
  it("单日全天事件只落在开始日（ICS-002：不换算、不漂移）", () => {
    expect(
      eventDateKeys(makeEvent({ start: "2026-10-08", allDay: true })),
    ).toEqual(["2026-10-08"]);
  });

  it("多日全天事件按独占 DTEND 展开：10-01 至 10-07", () => {
    expect(
      eventDateKeys(
        makeEvent({ start: "2026-10-01", end: "2026-10-08", allDay: true }),
      ),
    ).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
    ]);
  });

  it("结束日期不晚于开始日时按单日处理（容错）", () => {
    expect(
      eventDateKeys(
        makeEvent({ start: "2026-10-08", end: "2026-10-08", allDay: true }),
      ),
    ).toEqual(["2026-10-08"]);
    expect(
      eventDateKeys(
        makeEvent({ start: "2026-10-08", end: "2026-10-01", allDay: true }),
      ),
    ).toEqual(["2026-10-08"]);
  });

  it("浮动本地时间事件落在日期部分", () => {
    expect(eventDateKeys(makeEvent({ start: "2026-09-23T19:00:00" }))).toEqual([
      "2026-09-23",
    ]);
  });

  it("UTC 事件按本地日期落格", () => {
    const start = "2026-10-18T16:30:00.000Z";
    expect(eventDateKeys(makeEvent({ start }))).toEqual([
      todayKeyFromDate(new Date(start)),
    ]);
  });

  it("跨天时间事件覆盖开始日至结束日（如行程）", () => {
    expect(
      eventDateKeys(
        makeEvent({ start: "2026-09-25T19:00:00", end: "2026-09-27T02:00:00" }),
      ),
    ).toEqual(["2026-09-25", "2026-09-26", "2026-09-27"]);
  });

  it("时间事件结束恰为 00:00 时视为独占边界，不占那一天", () => {
    expect(
      eventDateKeys(
        makeEvent({ start: "2026-09-25T19:00:00", end: "2026-09-26T00:00:00" }),
      ),
    ).toEqual(["2026-09-25"]);
  });

  it("异常长的跨度被截断，防止病态数据拖垮渲染", () => {
    const keys = eventDateKeys(
      makeEvent({ start: "2026-01-01", end: "2028-03-01", allDay: true }),
    );
    expect(keys).toHaveLength(370);
    expect(keys[0]).toBe("2026-01-01");
    expect(keys.at(-1)).toBe("2027-01-05");
  });
});

describe("bucketEventsByDateKey", () => {
  it("同一天内全天在前、再按开始时间排序", () => {
    const late = makeEvent({
      uid: "late@example.com",
      start: "2026-09-23T21:00:00",
    });
    const early = makeEvent({
      uid: "early@example.com",
      start: "2026-09-23T08:30:00",
    });
    const allDay = makeEvent({
      uid: "allday@example.com",
      start: "2026-09-23",
      allDay: true,
    });

    const buckets = bucketEventsByDateKey([late, allDay, early]);
    const day = buckets.get("2026-09-23") ?? [];

    expect(day.map((event) => event.uid)).toEqual([
      "allday@example.com",
      "early@example.com",
      "late@example.com",
    ]);
  });

  it("无事件日期不产生空桶", () => {
    const buckets = bucketEventsByDateKey([
      makeEvent({ start: "2026-10-08", allDay: true }),
    ]);
    expect(buckets.has("2026-10-09")).toBe(false);
  });
});
