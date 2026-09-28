import { describe, expect, it } from "vitest";
import type { EnrichedEvent } from "../data/model";
import { gateEventsForBuiltinSources } from "./app-builtin-sources";

const fixture: EnrichedEvent = {
  uid: "match",
  sourceId: "import",
  title: "England vs Spain",
  start: "2026-09-26T20:00:00",
  allDay: false,
  normalizedTitle: "england vs spain",
  semantic: { type: "sport.fixture", subtype: "nations-league" },
};

describe("导入赛程属于我的日历", () => {
  it("开启时保留比赛载荷；关闭时隐藏用户事件", () => {
    expect(gateEventsForBuiltinSources([fixture], [])).toEqual([fixture]);
    expect(gateEventsForBuiltinSources([fixture], ["mine"])).toEqual([]);
  });
  it("内置节假日开关不影响导入赛程", () => {
    const events = [fixture];
    expect(gateEventsForBuiltinSources(events, ["cn-holiday"])).toBe(events);
  });
});
