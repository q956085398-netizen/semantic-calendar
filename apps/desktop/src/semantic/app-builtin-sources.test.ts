import { describe, expect, it } from "vitest";
import type { EnrichedEvent } from "../data/model";
import { planReminders } from "../notifications/reminder-plan";
import { gateEventsForBuiltinSources } from "./app-builtin-sources";

/**
 * 内置来源开关的展示效果（SC-018 / P-04）。
 *
 * 开关只改变“怎么显示”：事件对象本身（原始字段、识别结果）不被改写、
 * 不被删除，因此关掉某个来源之后再打开，展示与关闭前完全一致。
 */

function event(overrides: Partial<EnrichedEvent> = {}): EnrichedEvent {
  return {
    uid: "u1",
    sourceId: "local-ics:team",
    title: "Arsenal vs Manchester City",
    start: "2026-09-26T23:30:00",
    allDay: false,
    normalizedTitle: "arsenal vs manchester city",
    ...overrides,
  };
}

const FIXTURE = event({
  semantic: { type: "sport.fixture", subtype: "premier-league" },
  metadata: {
    accent: "var(--semantic-sport)",
    label: "英超",
    fixture: { competition: { id: "premier-league" }, teams: [] },
  },
});

const PLAIN = event({
  uid: "u2",
  title: "晚间例会",
  semantic: { type: "calendar.event" },
  metadata: { accent: "var(--semantic-personal)" },
});

describe("我的日历开关", () => {
  it("开启时事件原样进入展示", () => {
    expect(gateEventsForBuiltinSources([FIXTURE, PLAIN], [])).toEqual([
      FIXTURE,
      PLAIN,
    ]);
  });

  it("关闭后没有用户事件进入展示（数据层不受影响）", () => {
    expect(gateEventsForBuiltinSources([FIXTURE, PLAIN], ["mine"])).toEqual([]);
  });

  it("关闭时未知开关值不影响判定（只认目录里的 id）", () => {
    expect(
      gateEventsForBuiltinSources([PLAIN], ["not-a-source" as never]),
    ).toEqual([PLAIN]);
  });
});

describe("英超赛程开关", () => {
  it("关闭后比赛摘掉视图字段，事件本身与原始字段保留", () => {
    const [gated] = gateEventsForBuiltinSources([FIXTURE], ["premier-league"]);

    expect(gated.semantic).toBeUndefined();
    expect(gated.metadata).toBeUndefined();
    // 事件仍在：标题 / 时间照常显示，只是不再被当成比赛。
    expect(gated.title).toBe(FIXTURE.title);
    expect(gated.start).toBe(FIXTURE.start);
    // 原事件没有被就地改写（返回的是视图副本）。
    expect(FIXTURE.semantic).toBeDefined();
    expect(FIXTURE.metadata).toBeDefined();
  });

  it("关闭后提醒计划不再把事件当成比赛（semantic 一并摘掉）", () => {
    // 提醒计划先看 semantic.type、再回落到事件自带 VALARM（reminder-plan.ts）：
    // 只摘展示元数据的话，用户设置过的“比赛提醒”仍会弹，与界面的承诺矛盾。
    const nowMs = Date.parse("2026-09-26T12:00:00.000Z");
    const planOf = (events: EnrichedEvent[]) =>
      planReminders({
        events,
        notificationsEnabled: true,
        matchReminder: 60,
        nowMs,
      });

    expect(planOf([FIXTURE]).map((reminder) => reminder.source)).toEqual([
      "user-setting",
    ]);
    expect(
      planOf(gateEventsForBuiltinSources([FIXTURE], ["premier-league"])),
    ).toEqual([]);
  });

  it("普通事件不受影响，且保持同一个对象引用", () => {
    const [gated] = gateEventsForBuiltinSources([PLAIN], ["premier-league"]);
    expect(gated).toBe(PLAIN);
  });

  it("开关全开时不重建数组（引用不变，避免无谓重渲染）", () => {
    const events = [FIXTURE, PLAIN];
    expect(gateEventsForBuiltinSources(events, [])).toBe(events);
  });

  it("仅识别为比赛的事件被摘掉语义", () => {
    const holidayEvent = event({
      uid: "u3",
      semantic: { type: "holiday", subtype: "national-day" },
      metadata: { accent: "var(--semantic-holiday)", label: "节假日" },
    });

    const gated = gateEventsForBuiltinSources(
      [FIXTURE, holidayEvent],
      ["premier-league"],
    );
    expect(gated[0].semantic).toBeUndefined();
    expect(gated[1].semantic).toBeDefined();
    expect(gated[1].metadata).toBeDefined();
  });
});
