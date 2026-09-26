import { describe, expect, it } from "vitest";
import { parseIcsCalendar, parseIcsCalendarInChunks } from "./parse-ics";

/**
 * SC-006 / ICS-001–005：VEVENT 解析、基础字段映射与错误隔离。
 *
 * 时间约定：
 * - VALUE=DATE 全天事件原样保留 YYYY-MM-DD，不做任何时区换算（ICS-002）；
 * - Z 结尾的 UTC 时间转 ISO UTC；
 * - 浮动 / TZID 本地时间转无偏移本地 ISO，精确时区换算留给 SC-008。
 * 因此这些断言不依赖运行机器的时区。
 */

function wrap(...vevents: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Semantic Calendar//Test//CN",
    ...vevents,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

const BASIC_EVENT = [
  "BEGIN:VEVENT",
  "UID:match-1@example.com",
  "SUMMARY:Arsenal vs Manchester City",
  "DESCRIPTION:Premier League fixture",
  "LOCATION:Emirates Stadium",
  "DTSTART:20261018T163000Z",
  "DTEND:20261018T183000Z",
  "END:VEVENT",
].join("\r\n");

describe("parseIcsCalendar — 基础映射", () => {
  it("解析完整 VEVENT 并保留全部基础字段", () => {
    const result = parseIcsCalendar(wrap(BASIC_EVENT));

    expect(result.issues).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      uid: "match-1@example.com",
      title: "Arsenal vs Manchester City",
      description: "Premier League fixture",
      location: "Emirates Stadium",
      start: "2026-10-18T16:30:00.000Z",
      end: "2026-10-18T18:30:00.000Z",
      allDay: false,
    });
  });

  it("保留原始 ICS 片段供追溯与后续重新标准化（SEM-004）", () => {
    const result = parseIcsCalendar(wrap(BASIC_EVENT));

    expect(result.events[0].rawPayload).toContain("UID:match-1@example.com");
    expect(result.events[0].rawPayload).toContain("DTSTART:20261018T163000Z");
  });

  it("缺少 SUMMARY 时以空标题入库，不视为坏事件", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:no-summary@example.com",
          "DTSTART:20261018T163000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.issues).toEqual([]);
    expect(result.events[0].title).toBe("");
  });

  it("仅保留第一个同名字段（ICS 惯例），可携带 X- 扩展属性", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:dup@example.com",
          "SUMMARY:第一次",
          "SUMMARY:第二次",
          "DTSTART:20261018T163000Z",
          "X-CUSTOM-FLAG:whatever",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events[0].title).toBe("第一次");
  });
});

describe("parseIcsCalendar — 全天与时间格式", () => {
  it("VALUE=DATE 全天事件原样保留日期，不发生时区漂移（ICS-002）", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:holiday@example.com",
          "SUMMARY:国庆假期",
          "DTSTART;VALUE=DATE:20261001",
          "DTEND;VALUE=DATE:20261008",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events[0]).toMatchObject({
      allDay: true,
      start: "2026-10-01",
      end: "2026-10-08",
    });
  });

  it("浮动本地时间转为无偏移本地 ISO", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:floating@example.com",
          "SUMMARY:晚间例会",
          "DTSTART:20260923T190000",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events[0]).toMatchObject({
      allDay: false,
      start: "2026-09-23T19:00:00",
    });
  });

  it("TZID 时间按本地时间处理并保留在原始片段中，待 SC-008 精确换算", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:tzid@example.com",
          "SUMMARY:London kickoff",
          "DTSTART;TZID=Europe/London:20261018T150000",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events[0].start).toBe("2026-10-18T15:00:00");
    expect(result.events[0].rawPayload).toContain(
      "DTSTART;TZID=Europe/London:20261018T150000",
    );
  });

  it("DURATION 代替 DTEND 时计算结束时间", () => {
    const timed = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:duration-timed@example.com",
          "SUMMARY:会议",
          "DTSTART:20260923T190000",
          "DURATION:PT1H30M",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(timed.events[0].end).toBe("2026-09-23T20:30:00");

    const allDay = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:duration-day@example.com",
          "SUMMARY:出差",
          "DTSTART;VALUE=DATE:20260923",
          "DURATION:P2D",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(allDay.events[0].end).toBe("2026-09-25");
  });

  it("裸日期值（无 VALUE=DATE 参数）也按全天处理", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:bare-date@example.com",
          "SUMMARY:纪念日",
          "DTSTART:20261008",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events[0]).toMatchObject({
      allDay: true,
      start: "2026-10-08",
    });
  });
});

describe("parseIcsCalendar — 文本处理", () => {
  it("展开折叠行：长 SUMMARY 续行拼接还原", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:folded@example.com",
          "SUMMARY:Premier League Matchweek 8 Arsenal",
          "  vs Manchester City at Emirates Stadium",
          "DTSTART:20261018T163000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events[0].title).toBe(
      "Premier League Matchweek 8 Arsenal vs Manchester City at Emirates Stadium",
    );
  });

  it("还原 TEXT 转义：\\n \\, \\; \\\\", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:escaped@example.com",
          "SUMMARY:Team A\\, Team B \\; preview",
          "DESCRIPTION:Line 1\\nLine 2\\\\end",
          "DTSTART:20261018T163000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events[0].title).toBe("Team A, Team B ; preview");
    expect(result.events[0].description).toBe("Line 1\nLine 2\\end");
  });

  it("容忍 BOM 与 LF-only 行尾", () => {
    const text =
      "\uFEFFBEGIN:VCALENDAR\n" +
      "BEGIN:VEVENT\n" +
      "UID:lf@example.com\n" +
      "SUMMARY:LF event\n" +
      "DTSTART:20261018T163000Z\n" +
      "END:VEVENT\n" +
      "END:VCALENDAR\n";

    const result = parseIcsCalendar(text);

    expect(result.issues).toEqual([]);
    expect(result.events[0].title).toBe("LF event");
  });
});

describe("parseIcsCalendar — 组件边界", () => {
  it("跳过 VEVENT 内嵌的 VALARM，不污染外层字段", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:alarm@example.com",
          "SUMMARY:带提醒的比赛",
          "DESCRIPTION:外层描述",
          "DTSTART:20261018T163000Z",
          "BEGIN:VALARM",
          "TRIGGER:-PT30M",
          "DESCRIPTION:30 分钟前开赛",
          "END:VALARM",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0].description).toBe("外层描述");
    expect(result.events[0].title).toBe("带提醒的比赛");
  });

  it("忽略 VCALENDAR 之外的顶层属性", () => {
    const result = parseIcsCalendar(wrap(BASIC_EVENT));

    expect(result.events).toHaveLength(1);
  });
});

describe("parseIcsCalendar — 重复事件字段（SC-008 前置保留）", () => {
  it("保留 RRULE 与 EXDATE 原始值", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:rrule@example.com",
          "SUMMARY:每周站会",
          "DTSTART:20260923T090000",
          "RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=10",
          "EXDATE:20260930T090000",
          "EXDATE:20261007T090000",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events[0].recurrence).toEqual({
      rrule: "FREQ=WEEKLY;BYDAY=WE;COUNT=10",
      exdates: [{ value: "20260930T090000" }, { value: "20261007T090000" }],
    });
  });

  it("RECURRENCE-ID 规范化为 occurrenceId（ICS-001 身份）", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:rrule@example.com",
          "RECURRENCE-ID:20260923T090000",
          "SUMMARY:每周站会（改期）",
          "DTSTART:20260924T100000",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events[0].occurrenceId).toBe("2026-09-23T09:00:00");
  });

  it("EXDATE 的 TZID 与 VALUE=DATE 参数随原值保留", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:exdate-params@example.com",
          "SUMMARY:带参数的排除日期",
          "DTSTART;TZID=Asia/Shanghai:20260923T090000",
          "RRULE:FREQ=DAILY;COUNT=5",
          "EXDATE;TZID=Asia/Shanghai:20260930T090000,20261001T090000",
          "EXDATE;VALUE=DATE:20261002",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events[0].recurrence?.exdates).toEqual([
      { value: "20260930T090000", tzid: "Asia/Shanghai" },
      { value: "20261001T090000", tzid: "Asia/Shanghai" },
      { value: "20261002" },
    ]);
  });

  it("STATUS:CANCELLED 保留为 cancelled，其余 STATUS 不标记", () => {
    const cancelled = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:cancel@example.com",
          "RECURRENCE-ID:20260923T090000",
          "SUMMARY:这一场取消",
          "DTSTART:20260923T090000",
          "STATUS:CONFIRMED",
          "END:VEVENT",
          "BEGIN:VEVENT",
          "UID:cancel@example.com",
          "RECURRENCE-ID:20260930T090000",
          "SUMMARY:这一场真的取消",
          "DTSTART:20260930T090000",
          "STATUS:cancelled",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(cancelled.events[0].cancelled).toBeUndefined();
    expect(cancelled.events[1].cancelled).toBe(true);
  });
});

describe("parseIcsCalendar — 时区参数保留（SC-008 / ICS-003）", () => {
  it("DTSTART / DTEND 的 TZID 原文保留，时间值仍为无偏移墙钟 ISO", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:tzid@example.com",
          "SUMMARY:London meetup",
          "DTSTART;TZID=Europe/London:20261018T150000",
          "DTEND;TZID=Europe/London:20261018T170000",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events[0]).toMatchObject({
      start: "2026-10-18T15:00:00",
      end: "2026-10-18T17:00:00",
      startTzid: "Europe/London",
      endTzid: "Europe/London",
    });
  });

  it("UTC 与浮动时间不产生 TZID 字段", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:utc@example.com",
          "SUMMARY:UTC event",
          "DTSTART:20261018T163000Z",
          "END:VEVENT",
          "BEGIN:VEVENT",
          "UID:floating@example.com",
          "SUMMARY:Floating event",
          "DTSTART:20261018T163000",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events[0].startTzid).toBeUndefined();
    expect(result.events[1].startTzid).toBeUndefined();
  });
});

describe("parseIcsCalendar — 错误隔离（ICS-005）", () => {
  it("未闭合的 VEVENT 按坏事件报告，不静默消失", () => {
    const result = parseIcsCalendar(
      [
        "BEGIN:VCALENDAR",
        BASIC_EVENT,
        "BEGIN:VEVENT",
        "UID:truncated@example.com",
        "SUMMARY:被截断的事件",
        "DTSTART:20261018T163000Z",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );

    expect(result.events).toHaveLength(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      eventIndex: 2,
      message: "VEVENT 未闭合",
    });
  });

  it("缺 UID 的事件被跳过，其余事件继续导入", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "SUMMARY:没有 UID 的事件",
          "DTSTART:20261018T163000Z",
          "END:VEVENT",
          BASIC_EVENT,
        ].join("\r\n"),
      ),
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0].uid).toBe("match-1@example.com");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].eventIndex).toBe(1);
    expect(result.issues[0].message).toContain("UID");
  });

  it("缺 DTSTART 的事件被跳过并报告", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:no-start@example.com",
          "SUMMARY:没有开始时间",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events).toHaveLength(0);
    expect(result.issues[0].eventIndex).toBe(1);
    expect(result.issues[0].message).toContain("DTSTART");
  });

  it("DTSTART 格式非法的事件被跳过并报告", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:bad-date@example.com",
          "SUMMARY:坏日期",
          "DTSTART:not-a-date",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events).toHaveLength(0);
    expect(result.issues[0].message).toContain("DTSTART");
  });

  it("一个坏事件不会使整个文件失败：好坏混合导入", () => {
    const result = parseIcsCalendar(
      wrap(
        BASIC_EVENT,
        [
          "BEGIN:VEVENT",
          "UID:broken@example.com",
          "SUMMARY:坏事件",
          "DTSTART:20261345T990000Z",
          "END:VEVENT",
        ].join("\r\n"),
        [
          "BEGIN:VEVENT",
          "UID:match-2@example.com",
          "SUMMARY:Liverpool vs Chelsea",
          "DTSTART:20261025T150000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events).toHaveLength(2);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].eventIndex).toBe(2);
  });
});

describe("parseIcsCalendar — 文件级失败", () => {
  it("空文本：报告文件级问题，不抛异常", () => {
    const result = parseIcsCalendar("");

    expect(result.events).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].eventIndex).toBeUndefined();
  });

  it("非 ICS 文本：报告文件级问题", () => {
    const result = parseIcsCalendar("这是一个普通文本文件，不是日历。");

    expect(result.events).toEqual([]);
    expect(result.issues[0].eventIndex).toBeUndefined();
  });

  it("没有 VCALENDAR 包裹但含合法 VEVENT 时宽松解析", () => {
    const result = parseIcsCalendar(BASIC_EVENT + "\r\n");

    expect(result.issues).toEqual([]);
    expect(result.events).toHaveLength(1);
  });
});

/**
 * SC-017 / NOTIFY-002：事件自带提醒（VALARM）。
 *
 * 只把相对时间的 TRIGGER + ACTION:DISPLAY 当作本地提醒；绝对时间与
 * 邮件 / 铃声类动作不产生提醒（宁可不提醒，也不按错误的时间弹窗）。
 */
describe("parseIcsCalendar — 事件自带提醒（VALARM）", () => {
  function withAlarm(...alarmLines: string[]): string {
    return [
      "BEGIN:VEVENT",
      "UID:meeting@example.com",
      "SUMMARY:周会",
      "DTSTART:20260923T190000",
      "DTEND:20260923T200000",
      "BEGIN:VALARM",
      ...alarmLines,
      "END:VALARM",
      "END:VEVENT",
    ].join("\r\n");
  }

  it("解析提前 30 分钟的显示提醒", () => {
    const result = parseIcsCalendar(
      wrap(withAlarm("ACTION:DISPLAY", "DESCRIPTION:提醒", "TRIGGER:-PT30M")),
    );

    expect(result.issues).toEqual([]);
    expect(result.events[0].alarms).toEqual([
      { minutes: 30, direction: "before", related: "start" },
    ]);
  });

  it("支持按天 / 小时的提前量与多个提醒（顺序即原文顺序）", () => {
    const result = parseIcsCalendar(
      wrap(
        [
          "BEGIN:VEVENT",
          "UID:meeting@example.com",
          "SUMMARY:周会",
          "DTSTART:20260923T190000",
          "BEGIN:VALARM",
          "TRIGGER:-P1D",
          "ACTION:DISPLAY",
          "END:VALARM",
          "BEGIN:VALARM",
          "TRIGGER:-PT2H",
          "ACTION:DISPLAY",
          "END:VALARM",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events[0].alarms).toEqual([
      { minutes: 1440, direction: "before", related: "start" },
      { minutes: 120, direction: "before", related: "start" },
    ]);
  });

  it("RELATED=END 与正向偏移都按原文记录", () => {
    const result = parseIcsCalendar(
      wrap(
        withAlarm("TRIGGER;RELATED=END:-PT15M", "ACTION:DISPLAY"),
        [
          "BEGIN:VEVENT",
          "UID:second@example.com",
          "SUMMARY:另一个事件",
          "DTSTART:20260924T100000",
          "BEGIN:VALARM",
          "TRIGGER;RELATED=END:PT5M",
          "ACTION:DISPLAY",
          "END:VALARM",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events[0].alarms).toEqual([
      { minutes: 15, direction: "before", related: "end" },
    ]);
    expect(result.events[1].alarms).toEqual([
      { minutes: 5, direction: "after", related: "end" },
    ]);
  });

  it("绝对时间 TRIGGER 不产生提醒（不猜当地时刻）", () => {
    const result = parseIcsCalendar(
      wrap(
        withAlarm("TRIGGER;VALUE=DATE-TIME:20260923T120000Z", "ACTION:DISPLAY"),
      ),
    );

    expect(result.events[0].alarms).toBeUndefined();
  });

  it("EMAIL / AUDIO 类动作不产生本地提醒", () => {
    const result = parseIcsCalendar(
      wrap(
        withAlarm("TRIGGER:-PT30M", "ACTION:EMAIL", "ATTENDEE:mailto:a@b.c"),
        [
          "BEGIN:VEVENT",
          "UID:audio@example.com",
          "SUMMARY:带铃声的事件",
          "DTSTART:20260924T100000",
          "BEGIN:VALARM",
          "TRIGGER:-PT5M",
          "ACTION:AUDIO",
          "END:VALARM",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events[0].alarms).toBeUndefined();
    expect(result.events[1].alarms).toBeUndefined();
  });

  it("缺少 ACTION 时按显示提醒处理，TRIGGER 坏值则忽略", () => {
    const result = parseIcsCalendar(
      wrap(
        withAlarm("TRIGGER:-PT10M"),
        [
          "BEGIN:VEVENT",
          "UID:broken@example.com",
          "SUMMARY:坏 TRIGGER",
          "DTSTART:20260924T100000",
          "BEGIN:VALARM",
          "TRIGGER:明天早上",
          "ACTION:DISPLAY",
          "END:VALARM",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );

    expect(result.events[0].alarms).toEqual([
      { minutes: 10, direction: "before", related: "start" },
    ]);
    expect(result.events[1].alarms).toBeUndefined();
  });

  it("VALARM 原文仍保留在 rawPayload，且不影响顶层属性解析", () => {
    const result = parseIcsCalendar(
      wrap(withAlarm("TRIGGER:-PT30M", "ACTION:DISPLAY")),
    );

    expect(result.events[0].rawPayload).toContain("BEGIN:VALARM");
    expect(result.events[0]).toMatchObject({
      uid: "meeting@example.com",
      title: "周会",
      start: "2026-09-23T19:00:00",
      end: "2026-09-23T20:00:00",
    });
  });

  it("没有 VALARM 的事件不带 alarms 字段（不写空数组）", () => {
    const result = parseIcsCalendar(wrap(BASIC_EVENT));

    expect(result.events[0].alarms).toBeUndefined();
  });
});

/**
 * SC-024 / app-spec §15：分片解析。
 *
 * 被测的是「分片不改变结果」：三趟扫描（逐行展开、ICS 预检、切 VEVENT 块）
 * 与逐块解析各有让出点，不同的分片粒度下输出都必须与同步入口逐条相同——
 * 包括坏事件序号、未闭合块报告与折叠行跨片拼接。
 */
describe("parseIcsCalendarInChunks — 分片解析（SC-024）", () => {
  /** 覆盖折叠行、缩进续行、坏事件、未闭合块、嵌套 VALARM 与空行。 */
  const TRICKY_ICS = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:folded@example.com",
    "SUMMARY:折",
    " 叠后的标题",
    "DESCRIPTION:第一行\\n第二行",
    "DTSTART:20261018T163000Z",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    "END:VALARM",
    "END:VEVENT",
    "",
    "BEGIN:VEVENT",
    "UID:allday@example.com",
    "SUMMARY:全天安排",
    "DTSTART;VALUE=DATE:20261018",
    "DTEND;VALUE=DATE:20261020",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:broken@example.com",
    "SUMMARY:缺少开始时间",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:truncated@example.com",
    "SUMMARY:未闭合",
    "DTSTART:20261019T090000Z",
    "END:VCALENDAR",
    "",
  ].join("\r\n");

  function drain(text: string, chunkLines: number, chunkEvents: number) {
    const steps = parseIcsCalendarInChunks(text, chunkLines, chunkEvents);
    let yields = 0;
    let step = steps.next();
    while (!step.done) {
      yields += 1;
      step = steps.next();
    }
    return { result: step.value, yields };
  }

  it("结果与同步入口逐条相同（不同分片粒度下都是同一份输出）", () => {
    const expected = parseIcsCalendar(TRICKY_ICS);
    // 夹具本身要覆盖到坏事件与未闭合块，否则等价性测的是一路顺风的分支。
    expect(expected.events).toHaveLength(2);
    expect(expected.issues).toHaveLength(2);

    for (const [lines, blocks] of [
      [1, 1],
      [2, 1],
      [3, 2],
      [7, 3],
      [1000, 1000],
    ]) {
      expect(drain(TRICKY_ICS, lines, blocks).result).toEqual(expected);
    }
  });

  it("文件级失败同样分片：空文本与非 ICS 文本逐字相同", () => {
    for (const text of ["", "   \r\n", "这是一个普通文本文件。"]) {
      expect(drain(text, 1, 1).result).toEqual(parseIcsCalendar(text));
    }
  });

  it("分片粒度为 0 时中间不让出：一次 next 就结束（同步入口不切片）", () => {
    const steps = parseIcsCalendarInChunks(TRICKY_ICS, 0, 0);
    const first = steps.next();

    expect(first.done).toBe(true);
    expect(first.value).toEqual(parseIcsCalendar(TRICKY_ICS));
  });

  it("开启分片后行扫描与逐块解析各自都有让出点", () => {
    const { result, yields } = drain(TRICKY_ICS, 2, 1);

    // 行数远超粒度，块解析也超过粒度：两段都在让出。
    expect(yields).toBeGreaterThan(5);
    expect(result).toEqual(parseIcsCalendar(TRICKY_ICS));
  });

  it("空输入没有可让出的工作：不产生多余让出点", () => {
    expect(drain("", 1, 1).yields).toBe(0);
  });
});
