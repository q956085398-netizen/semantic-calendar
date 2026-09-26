import { describe, expect, it } from "vitest";
import {
  isValidSnapshotShape,
  narrowStoredEvent,
  narrowStoredSource,
} from "./schema";

/**
 * SC-019：快照记录的读取边界。
 * 规则本身在这里逐条验证；端到端效果（坏记录不崩月视图）在
 * calendar-store.test.ts 与 App.test.tsx 里。
 */

const validEvent = {
  uid: "event-1",
  sourceId: "source-1",
  title: "晚间例会",
  start: "2026-09-23T19:00:00",
  allDay: false,
};

describe("narrowStoredEvent：必需字段不合格则整条丢弃", () => {
  it("合法记录原样通过（含可选的日期形态字段）", () => {
    const event = narrowStoredEvent({
      ...validEvent,
      end: "2026-09-23T20:00:00",
      description: "带上电脑",
      location: "会议室",
      normalizedTitle: "晚间例会",
      timezone: "Asia/Shanghai",
      cancelled: false,
    });

    expect(event).toEqual({
      ...validEvent,
      end: "2026-09-23T20:00:00",
      description: "带上电脑",
      location: "会议室",
      normalizedTitle: "晚间例会",
      timezone: "Asia/Shanghai",
      cancelled: false,
    });
  });

  it.each([
    ["不是对象", 42],
    ["缺 uid", { ...validEvent, uid: undefined }],
    ["uid 为空串", { ...validEvent, uid: "" }],
    ["缺 sourceId", { ...validEvent, sourceId: undefined }],
    ["title 不是字符串", { ...validEvent, title: 7 }],
    ["缺 start", { ...validEvent, start: undefined }],
    ["start 不是日期形态", { ...validEvent, start: "下周三" }],
    ["allDay 不是布尔", { ...validEvent, allDay: "no" }],
  ])("%s → 丢弃", (_label, value) => {
    expect(narrowStoredEvent(value)).toBeNull();
  });

  it("end 不是日期形态时只丢该字段（事件的其余部分照常）", () => {
    const event = narrowStoredEvent({ ...validEvent, end: "看情况" });

    expect(event).toEqual(validEvent);
  });
});

describe("narrowStoredEvent：可选结构逐条收窄", () => {
  it("EXDATE 坏条目丢弃、好条目保留；只有 EXDATE 没有 RRULE 也保留", () => {
    expect(
      narrowStoredEvent({
        ...validEvent,
        recurrence: {
          exdates: [{ value: "20261004T190000" }, { value: 7 }, "x"],
        },
      })?.recurrence,
    ).toEqual({ exdates: [{ value: "20261004T190000" }] });

    // 规则文本不是字符串：整块丢弃而不是留下半个规则。
    expect(
      narrowStoredEvent({ ...validEvent, recurrence: { rrule: 42 } })
        ?.recurrence,
    ).toBeUndefined();
  });

  it("VALARM 只接受模型定义的偏移方向与基准", () => {
    const event = narrowStoredEvent({
      ...validEvent,
      alarms: [
        { minutes: 30, direction: "before", related: "start" },
        { minutes: 15, direction: "after", related: "end" },
        { minutes: -30, direction: "before", related: "start" },
        { minutes: 5, direction: "before" },
        { minutes: Number.NaN, direction: "before", related: "start" },
      ],
    });

    expect(event?.alarms).toEqual([
      { minutes: 30, direction: "before", related: "start" },
      { minutes: 15, direction: "after", related: "end" },
    ]);
  });
});

describe("narrowStoredSource", () => {
  const validSource = {
    id: "local-ics:team",
    type: "local-ics",
    name: "team.ics",
    enabled: true,
  };

  it("合法来源通过，未知的同步状态不猜", () => {
    expect(narrowStoredSource(validSource)).toEqual(validSource);
    expect(
      narrowStoredSource({ ...validSource, lastSyncStatus: "unknown" }),
    ).toEqual(validSource);
    expect(
      narrowStoredSource({
        ...validSource,
        lastSyncStatus: "error",
        lastSyncError: "网络请求失败",
      })?.lastSyncStatus,
    ).toBe("error");
  });

  it.each([
    ["缺 id", { ...validSource, id: "" }],
    ["未知类型", { ...validSource, type: "ftp" }],
    ["name 不是字符串", { ...validSource, name: null }],
    ["enabled 不是布尔", { ...validSource, enabled: undefined }],
  ])("%s → 丢弃", (_label, value) => {
    expect(narrowStoredSource(value)).toBeNull();
  });

  it("订阅没有可用地址时整条丢弃（地址就是订阅本身）", () => {
    expect(
      narrowStoredSource({
        id: "webcal:abc",
        type: "webcal",
        name: "example.com/feed.ics",
        enabled: true,
      }),
    ).toBeNull();
    expect(
      narrowStoredSource({
        id: "webcal:abc",
        type: "webcal",
        name: "example.com/feed.ics",
        enabled: true,
        webcal: { url: "https://example.com/feed.ics" },
      })?.webcal,
    ).toEqual({ url: "https://example.com/feed.ics" });
  });
});

describe("isValidSnapshotShape", () => {
  it("只判断分区形态", () => {
    expect(
      isValidSnapshotShape({
        schemaVersion: 1,
        sources: [],
        events: [],
        enrichments: {},
        settings: {},
      }),
    ).toBe(true);
    expect(isValidSnapshotShape({ sources: [] })).toBe(false);
    expect(isValidSnapshotShape(null)).toBe(false);
  });
});
