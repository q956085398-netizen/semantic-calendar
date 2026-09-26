import { describe, expect, it } from "vitest";
import type { EnrichedEvent, EventAlarm } from "../data/model";
import {
  MORNING_ANCHOR_HOUR,
  REMINDER_HORIZON_DAYS,
  REMINDER_LATE_TOLERANCE_MS,
  describeEventReminder,
  dueReminders,
  endInstantMs,
  expiredReminders,
  nextReminder,
  nextReminderDelay,
  planReminders,
  startInstantMs,
  type PlanRemindersInput,
} from "./reminder-plan";
import type { MatchReminderSetting } from "./notification-settings";

/**
 * SC-017 / NOTIFY-002–004：提醒时间计算与去重键。
 *
 * 断言全部用本地时间构造期望值（`local(...)`），与计划器“墙钟按观察者
 * 本地时间解释”的口径一致，因此不依赖运行机器的时区。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 本地墙钟 → epoch ms。 */
function local(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

function event(overrides: Partial<EnrichedEvent> = {}): EnrichedEvent {
  return {
    uid: "e1",
    sourceId: "src",
    title: "晚间例会",
    normalizedTitle: "晚间例会",
    start: "2026-09-23T19:00:00",
    allDay: false,
    ...overrides,
  };
}

/** 比赛事件：语义 + Resolver 建议（默认赛前 30 分钟）。 */
function matchEvent(overrides: Partial<EnrichedEvent> = {}): EnrichedEvent {
  return event({
    uid: "match-1",
    title: "Arsenal vs Manchester City",
    normalizedTitle: "Arsenal vs Manchester City",
    start: "2026-09-23T20:00:00",
    semantic: {
      type: "sport.fixture",
      subtype: "premier-league",
      entities: [
        { type: "team", id: "arsenal" },
        { type: "team", id: "manchester-city" },
      ],
    },
    metadata: { reminder: { kind: "minutes-before-start", minutes: 30 } },
    ...overrides,
  });
}

function plan(
  input: Partial<PlanRemindersInput> & { events: EnrichedEvent[] },
) {
  return planReminders({
    notificationsEnabled: true,
    matchReminder: undefined,
    nowMs: local(2026, 9, 23, 12, 0),
    ...input,
  });
}

describe("提醒时间计算（NOTIFY-002 / NOTIFY-003）", () => {
  it("比赛按 Resolver 的建议提醒（默认赛前 30 分钟）", () => {
    const reminders = plan({ events: [matchEvent()] });

    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      fireAtMs: local(2026, 9, 23, 19, 30),
      source: "resolver-policy",
      title: "Arsenal vs Manchester City",
    });
    expect(reminders[0].body).toContain("赛前 30 分钟");
    expect(reminders[0].body).toContain("20:00");
  });

  it("用户设置优先于默认建议（NOTIFY-003）", () => {
    const reminders = plan({
      events: [matchEvent()],
      matchReminder: 60,
    });

    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      fireAtMs: local(2026, 9, 23, 19, 0),
      source: "user-setting",
    });
    expect(reminders[0].body).toContain("赛前 60 分钟");
  });

  it("用户选择“不提醒”时比赛没有计划", () => {
    expect(plan({ events: [matchEvent()], matchReminder: null })).toEqual([]);
  });

  it("事件自带的 alarm 优先于默认建议（NOTIFY-002）", () => {
    const reminders = plan({
      events: [
        event({
          alarms: [{ minutes: 10, direction: "before", related: "start" }],
          metadata: { reminder: { kind: "minutes-before-start", minutes: 30 } },
          semantic: { type: "calendar.event" },
        }),
      ],
    });

    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      fireAtMs: local(2026, 9, 23, 18, 50),
      source: "event-alarm",
    });
    expect(reminders[0].body).toContain("提前 10 分钟");
  });

  it("用户设置优先于事件自带 alarm", () => {
    const reminders = plan({
      events: [
        matchEvent({
          alarms: [{ minutes: 10, direction: "before", related: "start" }],
        }),
      ],
      matchReminder: 60,
    });

    expect(reminders).toHaveLength(1);
    expect(reminders[0].source).toBe("user-setting");
    expect(reminders[0].fireAtMs).toBe(local(2026, 9, 23, 19, 0));
  });

  it("多个 alarm 各自成为一条提醒", () => {
    const alarms: EventAlarm[] = [
      { minutes: 60, direction: "before", related: "start" },
      { minutes: 10, direction: "before", related: "start" },
    ];
    const reminders = plan({ events: [event({ alarms })] });

    expect(reminders.map((reminder) => reminder.fireAtMs)).toEqual([
      local(2026, 9, 23, 18, 0),
      local(2026, 9, 23, 18, 50),
    ]);
    expect(new Set(reminders.map((reminder) => reminder.id)).size).toBe(2);
  });

  it("RELATED=END 的 alarm 以结束时间为基准", () => {
    const reminders = plan({
      events: [
        event({
          start: "2026-09-23T19:00:00",
          end: "2026-09-23T21:00:00",
          alarms: [{ minutes: 15, direction: "before", related: "end" }],
        }),
      ],
    });

    expect(reminders[0].fireAtMs).toBe(local(2026, 9, 23, 20, 45));
    expect(reminders[0].body).toContain("结束前 15 分钟");
  });

  it("“延后”型 alarm 在基准时间之后提醒", () => {
    const reminders = plan({
      events: [
        event({
          alarms: [{ minutes: 5, direction: "after", related: "start" }],
        }),
      ],
    });

    expect(reminders[0].fireAtMs).toBe(local(2026, 9, 23, 19, 5));
  });

  it("全天事件的“当天上午”落在当天 09:00", () => {
    const reminders = plan({
      events: [
        event({
          start: "2026-09-24",
          allDay: true,
          metadata: { reminder: { kind: "same-morning" } },
        }),
      ],
    });

    expect(reminders).toHaveLength(1);
    expect(reminders[0].fireAtMs).toBe(
      local(2026, 9, 24, MORNING_ANCHOR_HOUR, 0),
    );
  });

  it("“前一天晚上”落在前一天 20:00", () => {
    const reminders = plan({
      events: [
        event({
          metadata: { reminder: { kind: "previous-evening" } },
        }),
      ],
    });

    expect(reminders[0].fireAtMs).toBe(local(2026, 9, 22, 20, 0));
  });

  it("提醒晚于事件结束时不算（早上 9 点的提醒对 07:00 的会议没有意义）", () => {
    const reminders = plan({
      events: [
        event({
          start: "2026-09-23T07:00:00",
          end: "2026-09-23T08:00:00",
          metadata: { reminder: { kind: "same-morning" } },
        }),
      ],
    });

    expect(reminders).toEqual([]);
  });

  it("UTC 事件按绝对时刻计算", () => {
    const reminders = plan({
      events: [
        event({
          start: "2026-09-23T18:00:00.000Z",
          metadata: { reminder: { kind: "minutes-before-start", minutes: 30 } },
        }),
      ],
    });

    expect(reminders[0].fireAtMs).toBe(
      Date.parse("2026-09-23T18:00:00.000Z") - 30 * 60_000,
    );
  });
});

describe("计划边界与去重（NOTIFY-004）", () => {
  it("通知关闭时没有任何计划", () => {
    expect(
      plan({ events: [matchEvent()], notificationsEnabled: false }),
    ).toEqual([]);
  });

  it("超出计划窗口的提醒不进计划", () => {
    const far = matchEvent({
      uid: "far",
      start: "2026-11-05T20:00:00",
    });
    expect(plan({ events: [matchEvent(), far] })).toHaveLength(1);
    expect(
      plan({
        events: [far],
        nowMs: local(2026, 11, 4, 12, 0),
      }),
    ).toHaveLength(1);
    expect(REMINDER_HORIZON_DAYS).toBe(30);
  });

  it("取消的事件与坏时间不产生提醒", () => {
    expect(plan({ events: [matchEvent({ cancelled: true })] })).toEqual([]);
    expect(plan({ events: [matchEvent({ start: "not-a-time" })] })).toEqual([]);
  });

  it("已处理的提醒不再进入计划", () => {
    const first = plan({ events: [matchEvent()] });
    const handledIds = new Set([first[0].id]);

    expect(plan({ events: [matchEvent()], handledIds })).toEqual([]);
  });

  it("同一事件重复规划得到同一个去重键（刷新 / 重启不会重复弹）", () => {
    const a = plan({ events: [matchEvent()] });
    const b = plan({
      events: [matchEvent()],
      nowMs: local(2026, 9, 23, 12, 30),
    });

    expect(a[0].id).toBe(b[0].id);
  });

  it("改期后的提醒是新的键（用户确实需要新的提醒）", () => {
    const before = plan({ events: [matchEvent()] });
    const after = plan({
      events: [matchEvent({ start: "2026-09-23T21:00:00" })],
    });

    expect(after[0].id).not.toBe(before[0].id);
  });

  it("重复实例（occurrenceId）各自独立提醒", () => {
    const reminders = plan({
      events: [
        matchEvent({ occurrenceId: "2026-09-23T20:00:00" }),
        matchEvent({
          occurrenceId: "2026-09-30T20:00:00",
          start: "2026-09-30T20:00:00",
        }),
      ],
    });

    expect(reminders).toHaveLength(2);
    expect(new Set(reminders.map((reminder) => reminder.id)).size).toBe(2);
  });

  it("计划按触发时间升序排列", () => {
    const reminders = plan({
      events: [
        matchEvent({ uid: "late", start: "2026-09-25T20:00:00" }),
        matchEvent({ uid: "early", start: "2026-09-23T20:00:00" }),
      ],
    });

    expect(reminders.map((reminder) => reminder.fireAtMs)).toEqual([
      local(2026, 9, 23, 19, 30),
      local(2026, 9, 25, 19, 30),
    ]);
  });
});

describe("到期 / 错过 / 下一条", () => {
  const reminders = plan({ events: [matchEvent()] });

  it("到点即到期，未到点不到期", () => {
    expect(dueReminders(reminders, local(2026, 9, 23, 19, 29))).toEqual([]);
    expect(dueReminders(reminders, local(2026, 9, 23, 19, 30))).toHaveLength(1);
  });

  it("超过容忍窗口的提醒算错过，不再补发", () => {
    const fireAt = reminders[0].fireAtMs;
    expect(
      expiredReminders(reminders, fireAt + REMINDER_LATE_TOLERANCE_MS),
    ).toEqual([]);
    expect(
      expiredReminders(reminders, fireAt + REMINDER_LATE_TOLERANCE_MS + 1),
    ).toHaveLength(1);
  });

  it("下一条提醒与剩余延迟", () => {
    expect(nextReminder(reminders)?.fireAtMs).toBe(local(2026, 9, 23, 19, 30));
    expect(nextReminderDelay(reminders, local(2026, 9, 23, 19, 0))).toBe(
      30 * 60_000,
    );
    expect(nextReminderDelay(reminders, local(2026, 9, 23, 20, 0))).toBe(0);
    expect(nextReminder([])).toBeNull();
    expect(nextReminderDelay([], 0)).toBeNull();
  });
});

describe("事件时刻解释", () => {
  it("全天事件开始为当地零点，结束默认为次日零点", () => {
    const allDay = event({ start: "2026-09-24", allDay: true });
    const start = startInstantMs(allDay)!;

    expect(start).toBe(local(2026, 9, 24, 0, 0));
    expect(endInstantMs(allDay, start)).toBe(start + DAY_MS);
  });

  it("全天事件的结束日期按 ICS 的排他语义理解", () => {
    const allDay = event({
      start: "2026-09-24",
      end: "2026-09-26",
      allDay: true,
    });

    expect(endInstantMs(allDay, startInstantMs(allDay)!)).toBe(
      local(2026, 9, 26, 0, 0),
    );
  });

  it("无结束时间的定时事件结束即开始（RFC 零时长）", () => {
    const timed = event();
    expect(endInstantMs(timed, startInstantMs(timed)!)).toBe(
      startInstantMs(timed)!,
    );
  });

  it("墙钟按本地时间解释，UTC 按绝对时刻解释", () => {
    expect(startInstantMs(event({ start: "2026-09-23T19:00:00" }))).toBe(
      local(2026, 9, 23, 19, 0),
    );
    expect(startInstantMs(event({ start: "2026-09-23T19:00:00.000Z" }))).toBe(
      Date.parse("2026-09-23T19:00:00.000Z"),
    );
    expect(startInstantMs(event({ start: "" }))).toBeUndefined();
  });
});

describe("事件的提醒说明（Inspector 的提醒行）", () => {
  it("默认建议写成“建议提醒”", () => {
    expect(describeEventReminder(matchEvent(), undefined)).toEqual({
      label: "建议提醒",
      detail: "赛前 30 分钟",
    });
  });

  it("用户设置写成“提醒”，并标出来源", () => {
    expect(describeEventReminder(matchEvent(), 15)).toEqual({
      label: "提醒",
      detail: "赛前 15 分钟（用户设置）",
    });
  });

  it("事件自带提醒写明基准与来源", () => {
    expect(
      describeEventReminder(
        event({
          alarms: [
            { minutes: 10, direction: "before", related: "start" },
            { minutes: 30, direction: "before", related: "end" },
          ],
        }),
        undefined,
      ),
    ).toEqual({
      label: "提醒",
      detail: "提前 10 分钟（事件自带）、结束前 30 分钟（事件自带）",
    });
  });

  it("用户关闭比赛提醒时说明原因，而不是继续写建议", () => {
    expect(describeEventReminder(matchEvent(), null)).toEqual({
      label: "提醒",
      detail: "已关闭（用户设置）",
    });
  });

  it("没有可说的提醒时不给默认值（P-03）", () => {
    expect(describeEventReminder(event(), undefined)).toBeUndefined();
    expect(
      describeEventReminder(event({ metadata: {} }), undefined),
    ).toBeUndefined();
  });

  it("设置只作用于比赛，普通事件不受影响", () => {
    const plain: MatchReminderSetting = 15;
    expect(describeEventReminder(event(), plain)).toBeUndefined();
    expect(describeEventReminder(event(), null)).toBeUndefined();
  });
});
