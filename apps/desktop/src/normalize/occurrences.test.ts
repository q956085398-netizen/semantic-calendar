import { describe, expect, it } from "vitest";
import {
  expandEventOccurrences,
  expandEventOccurrencesInChunks,
} from "./occurrences";
import type { EnrichedEvent } from "../data/model";

/**
 * SC-008 核心接缝：读取路径的 occurrence 展开。
 *
 * 输入是“原始事实 + 可选增强”（store 读取形态），输出是窗口内可见的
 * 具体 occurrence（start / end 已规范化，生成实例带 occurrenceId）。
 * 预期值全部手算自 RFC 5545 / IANA tzdata，与实现方式无关。
 */

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

function startsOf(result: EnrichedEvent[]): string[] {
  return result.map((event) => event.start);
}

const WINDOW = { from: "2026-10-01", to: "2026-10-31" };

describe("expandEventOccurrences — 非重复事件规范化", () => {
  it("浮动 / UTC / 全天事件原样通过，不改动时间字段", () => {
    const events = [
      makeEvent({ uid: "f", start: "2026-10-05T19:30:00" }),
      makeEvent({
        uid: "u",
        start: "2026-10-05T16:30:00.000Z",
        end: "2026-10-05T18:30:00.000Z",
      }),
      makeEvent({
        uid: "a",
        start: "2026-10-06",
        end: "2026-10-08",
        allDay: true,
      }),
    ];

    const result = expandEventOccurrences(events, WINDOW);

    expect(result.map((event) => event.start)).toEqual([
      "2026-10-05T19:30:00",
      "2026-10-05T16:30:00.000Z",
      "2026-10-06",
    ]);
    expect(result.every((event) => event.occurrenceId === undefined)).toBe(
      true,
    );
  });

  it("TZID 墙钟时间换算为 UTC 瞬时（ICS-003），end 缺省沿用 DTSTART 时区", () => {
    const event = makeEvent({
      uid: "london",
      title: "London meetup",
      start: "2026-10-18T15:00:00",
      end: "2026-10-18T17:00:00",
      startTzid: "Europe/London",
    });
    // 10 月 18 日伦敦仍是 BST(+1)：15:00 → 14:00Z。
    const [occurrence] = expandEventOccurrences([event], WINDOW);
    expect(occurrence.start).toBe("2026-10-18T14:00:00.000Z");
    expect(occurrence.end).toBe("2026-10-18T16:00:00.000Z");
  });

  it("窗口外的事件不出现", () => {
    const events = [
      makeEvent({ uid: "early", start: "2026-09-30T23:00:00" }),
      makeEvent({ uid: "late", start: "2026-11-01T00:30:00" }),
    ];

    expect(expandEventOccurrences(events, WINDOW)).toEqual([]);
  });

  it("非法 TZID 降级为浮动时间，事件不消失（app-spec §13）", () => {
    const event = makeEvent({
      start: "2026-10-18T15:00:00",
      startTzid: "Mars/Olympus",
    });

    const [occurrence] = expandEventOccurrences([event], WINDOW);
    expect(occurrence.start).toBe("2026-10-18T15:00:00");
  });
});

describe("expandEventOccurrences — RRULE 展开（ICS-004）", () => {
  it("FREQ=DAILY：窗口内每天一个实例，生成实例带 occurrenceId（墙钟身份）", () => {
    const event = makeEvent({
      uid: "daily",
      title: "每日站会",
      start: "2026-09-30T09:00:00",
      recurrence: { rrule: "FREQ=DAILY", exdates: [] },
    });

    const result = expandEventOccurrences([event], WINDOW);

    expect(result).toHaveLength(31);
    expect(result[0]).toMatchObject({
      start: "2026-10-01T09:00:00",
      occurrenceId: "2026-10-01T09:00:00",
    });
    expect(result[30].start).toBe("2026-10-31T09:00:00");
  });

  it("FREQ=DAILY;INTERVAL=2：隔日展开，锚定 DTSTART", () => {
    const event = makeEvent({
      uid: "alt",
      start: "2026-10-01T08:00:00",
      recurrence: { rrule: "FREQ=DAILY;INTERVAL=2", exdates: [] },
    });

    expect(startsOf(expandEventOccurrences([event], WINDOW))).toEqual([
      "2026-10-01T08:00:00",
      "2026-10-03T08:00:00",
      "2026-10-05T08:00:00",
      "2026-10-07T08:00:00",
      "2026-10-09T08:00:00",
      "2026-10-11T08:00:00",
      "2026-10-13T08:00:00",
      "2026-10-15T08:00:00",
      "2026-10-17T08:00:00",
      "2026-10-19T08:00:00",
      "2026-10-21T08:00:00",
      "2026-10-23T08:00:00",
      "2026-10-25T08:00:00",
      "2026-10-27T08:00:00",
      "2026-10-29T08:00:00",
      "2026-10-31T08:00:00",
    ]);
  });

  it("COUNT 截断：总数含 DTSTART，窗口内只保留前 COUNT 个", () => {
    const event = makeEvent({
      uid: "capped",
      start: "2026-09-20T09:00:00",
      recurrence: { rrule: "FREQ=DAILY;COUNT=10", exdates: [] },
    });

    expect(expandEventOccurrences([event], WINDOW)).toEqual([]);
  });

  it("UNTIL 含边界当天（墙钟形态）", () => {
    const event = makeEvent({
      uid: "until-wall",
      start: "2026-09-28T09:00:00",
      recurrence: {
        rrule: "FREQ=DAILY;UNTIL=20261004T090000",
        exdates: [],
      },
    });

    expect(startsOf(expandEventOccurrences([event], WINDOW))).toEqual([
      "2026-10-01T09:00:00",
      "2026-10-02T09:00:00",
      "2026-10-03T09:00:00",
      "2026-10-04T09:00:00",
    ]);
  });

  it("全天 DAILY 规则同样展开，occurrenceId 为日期键", () => {
    const event = makeEvent({
      uid: "allday-daily",
      title: "假期倒计时",
      start: "2026-10-01",
      allDay: true,
      recurrence: { rrule: "FREQ=DAILY;COUNT=3", exdates: [] },
    });

    const result = expandEventOccurrences([event], WINDOW);
    expect(startsOf(result)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
    expect(result[0].occurrenceId).toBe("2026-10-01");
  });

  it("FREQ=WEEKLY：默认重复 DTSTART 的平日（2026-10 的四个周三）", () => {
    const event = makeEvent({
      uid: "weekly-default",
      start: "2026-09-30T09:00:00", // 周三
      recurrence: { rrule: "FREQ=WEEKLY", exdates: [] },
    });

    expect(startsOf(expandEventOccurrences([event], WINDOW))).toEqual([
      "2026-10-07T09:00:00",
      "2026-10-14T09:00:00",
      "2026-10-21T09:00:00",
      "2026-10-28T09:00:00",
    ]);
  });

  it("FREQ=WEEKLY;BYDAY=MO,WE,FR：DTSTART 所在周起每周三日", () => {
    const event = makeEvent({
      uid: "weekly-byday",
      start: "2026-09-28T10:00:00", // 周一
      recurrence: { rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR", exdates: [] },
    });

    expect(startsOf(expandEventOccurrences([event], WINDOW))).toEqual([
      "2026-10-02T10:00:00",
      "2026-10-05T10:00:00",
      "2026-10-07T10:00:00",
      "2026-10-09T10:00:00",
      "2026-10-12T10:00:00",
      "2026-10-14T10:00:00",
      "2026-10-16T10:00:00",
      "2026-10-19T10:00:00",
      "2026-10-21T10:00:00",
      "2026-10-23T10:00:00",
      "2026-10-26T10:00:00",
      "2026-10-28T10:00:00",
      "2026-10-30T10:00:00",
    ]);
  });

  it("FREQ=WEEKLY;INTERVAL=2：双周对齐锚定 DTSTART 所在周（周一起始）", () => {
    const event = makeEvent({
      uid: "biweekly",
      start: "2026-09-30T09:00:00", // 周三，所在周 09-28 起
      recurrence: { rrule: "FREQ=WEEKLY;INTERVAL=2", exdates: [] },
    });

    expect(startsOf(expandEventOccurrences([event], WINDOW))).toEqual([
      "2026-10-14T09:00:00",
      "2026-10-28T09:00:00",
    ]);
  });

  it("FREQ=MONTHLY：默认重复当月同日，没有 31 号的月份跳过", () => {
    const event = makeEvent({
      uid: "monthly-31",
      start: "2026-08-31T09:00:00",
      recurrence: { rrule: "FREQ=MONTHLY", exdates: [] },
    });

    expect(startsOf(expandEventOccurrences([event], WINDOW))).toEqual([
      "2026-10-31T09:00:00",
    ]);
  });

  it("FREQ=MONTHLY;BYDAY=2TU：每月第二个周二（2026-10-13）", () => {
    const event = makeEvent({
      uid: "monthly-2tu",
      start: "2026-08-11T15:00:00", // 8 月第二个周二
      recurrence: { rrule: "FREQ=MONTHLY;BYDAY=2TU", exdates: [] },
    });

    expect(startsOf(expandEventOccurrences([event], WINDOW))).toEqual([
      "2026-10-13T15:00:00",
    ]);
  });

  it("FREQ=MONTHLY;BYDAY=-1FR：每月最后一个周五（2026-10-30）", () => {
    const event = makeEvent({
      uid: "monthly-last-fr",
      start: "2026-09-25T18:00:00", // 9 月最后一个周五
      recurrence: { rrule: "FREQ=MONTHLY;BYDAY=-1FR", exdates: [] },
    });

    expect(startsOf(expandEventOccurrences([event], WINDOW))).toEqual([
      "2026-10-30T18:00:00",
    ]);
  });

  it("FREQ=MONTHLY;BYMONTHDAY=15：每月 15 号", () => {
    const event = makeEvent({
      uid: "monthly-15",
      start: "2026-08-15T09:00:00",
      recurrence: { rrule: "FREQ=MONTHLY;BYMONTHDAY=15", exdates: [] },
    });

    expect(startsOf(expandEventOccurrences([event], WINDOW))).toEqual([
      "2026-10-15T09:00:00",
    ]);
  });

  it("FREQ=YEARLY：周年重复，2 月 29 日在非闰年跳过", () => {
    const leapDay = makeEvent({
      uid: "yearly-leap",
      start: "2024-02-29T09:00:00",
      allDay: true,
      recurrence: { rrule: "FREQ=YEARLY", exdates: [] },
    });

    expect(expandEventOccurrences([leapDay], WINDOW)).toEqual([]);
    expect(
      startsOf(
        expandEventOccurrences([leapDay], {
          from: "2028-01-01",
          to: "2028-12-31",
        }),
      ),
    ).toEqual(["2028-02-29"]);

    const anniversary = makeEvent({
      uid: "yearly-normal",
      start: "2026-10-01T09:00:00",
      recurrence: { rrule: "FREQ=YEARLY", exdates: [] },
    });
    expect(startsOf(expandEventOccurrences([anniversary], WINDOW))).toEqual([
      "2026-10-01T09:00:00",
    ]);
  });

  it("Z 形态 master 按固定 UTC 瞬时步进，身份为 .000Z 形态", () => {
    const event = makeEvent({
      uid: "utc-daily",
      start: "2026-09-30T09:00:00.000Z",
      recurrence: { rrule: "FREQ=DAILY;COUNT=5", exdates: [] },
    });

    const result = expandEventOccurrences([event], WINDOW);
    expect(result).toHaveLength(4); // 09-30 在窗口外
    expect(result[0]).toMatchObject({
      start: "2026-10-01T09:00:00.000Z",
      occurrenceId: "2026-10-01T09:00:00.000Z",
    });
  });

  it("TZID 每周规则跨夏令时：墙钟 15:00 不变，UTC 瞬时随偏移变化", () => {
    const event = makeEvent({
      uid: "london-weekly",
      title: "London weekly",
      start: "2026-09-30T15:00:00", // 周三
      startTzid: "Europe/London",
      recurrence: { rrule: "FREQ=WEEKLY", exdates: [] },
    });

    const result = expandEventOccurrences([event], WINDOW);
    expect(startsOf(result)).toEqual([
      "2026-10-07T14:00:00.000Z", // BST +1
      "2026-10-14T14:00:00.000Z",
      "2026-10-21T14:00:00.000Z",
      "2026-10-28T15:00:00.000Z", // 10-25 后 GMT +0
    ]);
    expect(result[3].occurrenceId).toBe("2026-10-28T15:00:00");
  });
});

describe("expandEventOccurrences — EXDATE 与例外（ICS-004 / ICS-001）", () => {
  function weeklyWednesdayMaster() {
    return makeEvent({
      uid: "weekly",
      title: "每周站会",
      start: "2026-09-30T09:00:00", // 周三
      recurrence: { rrule: "FREQ=WEEKLY", exdates: [] },
    });
  }

  it("EXDATE 排除命中实例（墙钟形态）", () => {
    const event = {
      ...weeklyWednesdayMaster(),
      recurrence: {
        rrule: "FREQ=DAILY",
        exdates: [{ value: "20261005T090000" }],
      },
      start: "2026-09-30T09:00:00",
    };

    const result = expandEventOccurrences([event], WINDOW);
    expect(result).toHaveLength(30); // 10 月 31 天 - 1 个 EXDATE
    expect(result.some((o) => o.start === "2026-10-05T09:00:00")).toBe(false);
  });

  it("全天规则的 EXDATE VALUE=DATE 按日期排除", () => {
    const event = makeEvent({
      uid: "allday-exdate",
      start: "2026-10-01",
      allDay: true,
      recurrence: {
        rrule: "FREQ=DAILY;COUNT=5",
        exdates: [{ value: "20261003" }],
      },
    });

    expect(startsOf(expandEventOccurrences([event], WINDOW))).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-04",
      "2026-10-05",
    ]);
  });

  it("EXDATE 的 Z 形态与 TZID master 在 UTC 空间匹配", () => {
    // 上海 2026-10-05T09:00(+8) = 2026-10-05T01:00:00Z。
    const event = makeEvent({
      uid: "shanghai-daily",
      start: "2026-10-01T09:00:00",
      startTzid: "Asia/Shanghai",
      recurrence: {
        rrule: "FREQ=DAILY;COUNT=10",
        exdates: [{ value: "20261005T010000Z" }],
      },
    });

    const result = expandEventOccurrences([event], WINDOW);
    expect(result).toHaveLength(9);
    expect(result.some((o) => o.occurrenceId === "2026-10-05T09:00:00")).toBe(
      false,
    );
  });

  it("RECURRENCE-ID 例外改期：替换原实例且不重复（ICS-001）", () => {
    const master = weeklyWednesdayMaster();
    const moved = makeEvent({
      uid: "weekly",
      title: "每周站会（改期）",
      start: "2026-10-15T11:00:00",
      occurrenceId: "2026-10-14T09:00:00",
    });

    const result = expandEventOccurrences([master, moved], WINDOW);
    const wednesdays = result.filter((o) => o.title === "每周站会");
    expect(startsOf(wednesdays)).toEqual([
      "2026-10-07T09:00:00",
      "2026-10-21T09:00:00",
      "2026-10-28T09:00:00",
    ]);
    const movedOccurrence = result.find((o) => o.title === "每周站会（改期）");
    expect(movedOccurrence).toMatchObject({
      start: "2026-10-15T11:00:00",
      occurrenceId: "2026-10-14T09:00:00",
    });
    // 原 10-14 时间槽没有任何实例。
    expect(result.some((o) => o.start === "2026-10-14T09:00:00")).toBe(false);
  });

  it("STATUS:CANCELLED 例外取消对应实例", () => {
    const master = weeklyWednesdayMaster();
    const cancelled = makeEvent({
      uid: "weekly",
      title: "每周站会",
      start: "2026-10-21T09:00:00",
      occurrenceId: "2026-10-21T09:00:00",
      cancelled: true,
    });

    const result = expandEventOccurrences([master, cancelled], WINDOW);
    expect(startsOf(result)).toEqual([
      "2026-10-07T09:00:00",
      "2026-10-14T09:00:00",
      "2026-10-28T09:00:00",
    ]);
  });

  it("例外指向窗口外的原实例时按自身时间展示（孤儿例外）", () => {
    const master = weeklyWednesdayMaster();
    const moved = makeEvent({
      uid: "weekly",
      title: "每周站会（改期到 12 月）",
      start: "2026-12-24T09:00:00",
      occurrenceId: "2026-10-07T09:00:00",
    });

    const result = expandEventOccurrences([master, moved], WINDOW);
    // 10-07 被例外替换；例外自身在 12 月，不在窗口内。
    expect(startsOf(result)).toEqual([
      "2026-10-14T09:00:00",
      "2026-10-21T09:00:00",
      "2026-10-28T09:00:00",
    ]);
    expect(result.some((o) => o.title === "每周站会（改期到 12 月）")).toBe(
      false,
    );
  });

  it("没有 master 的孤儿例外按自身时间展示", () => {
    const orphan = makeEvent({
      uid: "orphan",
      title: "单独例外",
      start: "2026-10-10T09:00:00",
      occurrenceId: "2026-10-07T09:00:00",
    });

    const result = expandEventOccurrences([orphan], WINDOW);
    expect(startsOf(result)).toEqual(["2026-10-10T09:00:00"]);
  });
});

describe("expandEventOccurrences — 窗口与防御", () => {
  it("开始于窗口前的多日事件因结束日与窗口相交而保留", () => {
    const event = makeEvent({
      uid: "spanning",
      title: "长假",
      start: "2026-09-28",
      end: "2026-10-03", // 独占：覆盖 09-28 … 10-02
      allDay: true,
    });

    expect(startsOf(expandEventOccurrences([event], WINDOW))).toEqual([
      "2026-09-28",
    ]);
  });

  it("窗口前的候选只计数、不物化：COUNT 仍按 DTSTART 起算（SC-020）", () => {
    const event = makeEvent({
      uid: "long-weekly",
      start: "2026-01-05T09:00:00", // 周一，第 1 个实例
      recurrence: { rrule: "FREQ=WEEKLY;COUNT=40", exdates: [] },
    });

    // 第 40 个实例 = 2026-01-05 + 39 周 = 2026-10-05；第 41 个不存在。
    // 窗口前那 39 个候选只参与计数，不进入结果（也不做时区换算）。
    expect(startsOf(expandEventOccurrences([event], WINDOW))).toEqual([
      "2026-10-05T09:00:00",
    ]);
  });

  it("UNTIL 远在窗口之后：窗口内实例照常展开（SC-020 的边界快路径）", () => {
    const event = makeEvent({
      uid: "until-far",
      start: "2026-06-03T09:00:00.000Z", // 周三
      recurrence: {
        rrule: "FREQ=WEEKLY;UNTIL=20261230T090000Z",
        exdates: [],
      },
    });

    expect(startsOf(expandEventOccurrences([event], WINDOW))).toEqual([
      "2026-10-07T09:00:00.000Z",
      "2026-10-14T09:00:00.000Z",
      "2026-10-21T09:00:00.000Z",
      "2026-10-28T09:00:00.000Z",
    ]);
  });

  it("改期例外指向窗口前的实例、自身落在窗口内：仍然展示（SC-020）", () => {
    const master = makeEvent({
      uid: "weekly",
      title: "每周站会",
      start: "2026-06-03T09:00:00", // 周三
      recurrence: { rrule: "FREQ=WEEKLY", exdates: [] },
    });
    const moved = makeEvent({
      uid: "weekly",
      title: "每周站会（改期）",
      start: "2026-10-09T15:00:00",
      occurrenceId: "2026-09-30T09:00:00", // 窗口前的一个实例
    });

    // 内容按时间排序比较：输出顺序不是契约（月格分桶与提醒计划都会再排序），
    // 被跳过候选认领的例外与走“孤儿例外”通道的例外内容相同。
    expect(
      startsOf(expandEventOccurrences([master, moved], WINDOW)).sort(),
    ).toEqual(
      [
        "2026-10-07T09:00:00",
        "2026-10-09T15:00:00",
        "2026-10-14T09:00:00",
        "2026-10-21T09:00:00",
        "2026-10-28T09:00:00",
      ].sort(),
    );
  });

  it("久远 DTSTART 的无界 DAILY 不卡死（迭代上限）", () => {
    const event = makeEvent({
      uid: "ancient",
      start: "0001-01-01T00:00:00",
      recurrence: { rrule: "FREQ=DAILY", exdates: [] },
    });

    expect(expandEventOccurrences([event], WINDOW)).toEqual([]);
  });

  it("1970 年起的日常规则可正常展开到当前窗口", () => {
    const event = makeEvent({
      uid: "since-1970",
      start: "1970-01-01T00:00:00",
      recurrence: { rrule: "FREQ=DAILY", exdates: [] },
    });

    expect(expandEventOccurrences([event], WINDOW)).toHaveLength(31);
  });

  it("无法安全解释的 RRULE 降级为单次事件（P-01）", () => {
    const event = makeEvent({
      uid: "unsupported",
      title: "每月第一个工作日",
      start: "2026-09-01T09:00:00",
      recurrence: {
        rrule: "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1",
        exdates: [],
      },
    });

    expect(startsOf(expandEventOccurrences([event], WINDOW))).toEqual([]);
  });
});

describe("expandEventOccurrences — 审查修复回归", () => {
  it("DAILY 的 BYDAY 作为过滤器：工作日规则只展开周一到周五", () => {
    const event = makeEvent({
      uid: "workdays",
      start: "2026-10-01T09:00:00", // 周四
      recurrence: {
        rrule: "FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR",
        exdates: [],
      },
    });

    expect(startsOf(expandEventOccurrences([event], WINDOW))).toEqual([
      "2026-10-01T09:00:00", // 四
      "2026-10-02T09:00:00", // 五
      "2026-10-05T09:00:00", // 一
      "2026-10-06T09:00:00",
      "2026-10-07T09:00:00",
      "2026-10-08T09:00:00",
      "2026-10-09T09:00:00",
      "2026-10-12T09:00:00",
      "2026-10-13T09:00:00",
      "2026-10-14T09:00:00",
      "2026-10-15T09:00:00",
      "2026-10-16T09:00:00",
      "2026-10-19T09:00:00",
      "2026-10-20T09:00:00",
      "2026-10-21T09:00:00",
      "2026-10-22T09:00:00",
      "2026-10-23T09:00:00",
      "2026-10-26T09:00:00",
      "2026-10-27T09:00:00",
      "2026-10-28T09:00:00",
      "2026-10-29T09:00:00",
      "2026-10-30T09:00:00",
    ]);
  });

  it("日期形态 EXDATE 对时间事件按“排除当天实例”宽容处理", () => {
    const event = makeEvent({
      uid: "date-exdate",
      start: "2026-10-01T09:00:00",
      recurrence: {
        rrule: "FREQ=DAILY;COUNT=5",
        exdates: [{ value: "20261003" }],
      },
    });

    expect(startsOf(expandEventOccurrences([event], WINDOW))).toEqual([
      "2026-10-01T09:00:00",
      "2026-10-02T09:00:00",
      "2026-10-04T09:00:00",
      "2026-10-05T09:00:00",
    ]);
  });

  it("EXDATE 自带与 master 不同的 TZID 时在 UTC 空间匹配", () => {
    // 上海 2026-10-03T09:00(+8) = 01:00Z = 伦敦 02:00 BST。
    const event = makeEvent({
      uid: "cross-zone-exdate",
      start: "2026-10-01T09:00:00",
      startTzid: "Asia/Shanghai",
      recurrence: {
        rrule: "FREQ=DAILY;COUNT=5",
        exdates: [{ value: "20261003T020000", tzid: "Europe/London" }],
      },
    });

    const result = expandEventOccurrences([event], WINDOW);
    expect(result).toHaveLength(4);
    expect(result.some((o) => o.occurrenceId === "2026-10-03T09:00:00")).toBe(
      false,
    );
  });

  it("指向候选流之外实例的改期例外按自身时间展示（不静默丢失）", () => {
    const master = makeEvent({
      uid: "series",
      title: "每周例会",
      start: "2026-09-30T09:00:00", // 周三
      recurrence: { rrule: "FREQ=WEEKLY;COUNT=8", exdates: [] },
    });
    // 原实例 11-04 超出 10 月窗口的候选流；改期到窗口内 10-15。
    const movedIn = makeEvent({
      uid: "series",
      title: "每周例会（改期）",
      start: "2026-10-15T11:00:00",
      occurrenceId: "2026-11-04T09:00:00",
    });

    const result = expandEventOccurrences([master, movedIn], WINDOW);
    expect(result.find((o) => o.title === "每周例会（改期）")).toMatchObject({
      start: "2026-10-15T11:00:00",
      occurrenceId: "2026-11-04T09:00:00",
    });
    // 原系列在 10 月仍正常展开。
    expect(startsOf(result.filter((o) => o.title === "每周例会"))).toEqual([
      "2026-10-07T09:00:00",
      "2026-10-14T09:00:00",
      "2026-10-21T09:00:00",
      "2026-10-28T09:00:00",
    ]);
  });

  it("MONTHLY 同时给出 BYDAY 与 BYMONTHDAY 时取交集（RFC 语义）", () => {
    // 周一 且 12/13 号：10 月只有 10-12 是周一。
    const event = makeEvent({
      uid: "monthly-intersect",
      start: "2026-09-14T09:00:00", // 9 月的周一
      recurrence: {
        rrule: "FREQ=MONTHLY;BYDAY=MO;BYMONTHDAY=12,13",
        exdates: [],
      },
    });

    expect(startsOf(expandEventOccurrences([event], WINDOW))).toEqual([
      "2026-10-12T09:00:00",
    ]);
  });
});

describe("expandEventOccurrencesInChunks — 分片展开（SC-020）", () => {
  /**
   * 覆盖三段扫描各自的边界形态：无重复事件（单次分支）、重复 master、
   * 取消 / 改期例外（在 master 那一趟被消费）、孤儿例外（第三趟），
   * 以及窗口外事件。分片不得改变其中任何一条的输出顺序或内容。
   */
  function trickyEvents(): EnrichedEvent[] {
    return [
      makeEvent({ uid: "plain", start: "2026-10-05T09:00:00" }),
      makeEvent({
        uid: "allday",
        start: "2026-10-06",
        end: "2026-10-09",
        allDay: true,
      }),
      makeEvent({
        uid: "outside",
        start: "2026-12-01T09:00:00",
      }),
      makeEvent({
        uid: "weekly",
        start: "2026-09-30T09:00:00",
        recurrence: { rrule: "FREQ=WEEKLY;COUNT=8", exdates: [] },
      }),
      makeEvent({
        uid: "daily",
        start: "2026-09-28T08:00:00",
        recurrence: {
          rrule: "FREQ=DAILY;INTERVAL=2",
          exdates: [{ value: "20261006T080000" }],
        },
      }),
      makeEvent({
        uid: "series",
        start: "2026-10-07T11:00:00",
        occurrenceId: "2026-10-07T11:00:00",
        cancelled: true,
      }),
      makeEvent({
        uid: "weekly",
        start: "2026-10-14T15:00:00",
        occurrenceId: "2026-10-14T09:00:00",
      }),
      // 没有 master 的孤儿例外：第三趟扫描才会产出。
      makeEvent({
        uid: "orphan",
        start: "2026-10-20T10:00:00",
        occurrenceId: "2026-10-20T10:00:00",
      }),
    ];
  }

  function drain(
    chunkEvents: number,
    events: EnrichedEvent[] = trickyEvents(),
  ): { result: EnrichedEvent[]; yields: number } {
    const steps = expandEventOccurrencesInChunks(events, WINDOW, chunkEvents);
    let yields = 0;
    let step = steps.next();
    while (!step.done) {
      yields += 1;
      step = steps.next();
    }
    return { result: step.value, yields };
  }

  it("结果与同步入口逐条相同（不同分片粒度下都是同一份输出）", () => {
    const expected = expandEventOccurrences(trickyEvents(), WINDOW);
    expect(expected.length).toBeGreaterThan(5);
    for (const chunkEvents of [1, 2, 3, 5, 100]) {
      expect(drain(chunkEvents).result).toEqual(expected);
    }
  });

  it("分片粒度为 0 时中间不让出：一次 next 就结束（同步入口不切片）", () => {
    const steps = expandEventOccurrencesInChunks(trickyEvents(), WINDOW, 0);
    const first = steps.next();
    expect(first.done).toBe(true);
    expect(first.value).toEqual(expandEventOccurrences(trickyEvents(), WINDOW));
  });

  it("开启分片后每片之间都有让出点，且最终结果不变", () => {
    const { result, yields } = drain(2);
    // 三趟扫描各自至少一次让出（每趟结束时让出一次，趟与趟之间才能重绘）。
    expect(yields).toBeGreaterThanOrEqual(3);
    expect(result).toEqual(expandEventOccurrences(trickyEvents(), WINDOW));
  });

  it("空输入不产生让出点之外的多余工作", () => {
    const { result, yields } = drain(2, []);
    expect(result).toEqual([]);
    expect(yields).toBeGreaterThanOrEqual(1);
  });
});
