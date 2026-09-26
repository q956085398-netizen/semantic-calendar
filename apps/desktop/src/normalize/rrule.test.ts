import { describe, expect, it } from "vitest";
import { parseRrule } from "./rrule";

/**
 * SC-008 / ICS-004：RRULE 文本 → 受控结构。
 *
 * 策略：只接受能精确兑现的规则；无法兑现的（BYSETPOS 等会改变语义的
 * 部分、不支持的 FREQ）返回 undefined，调用方降级为单次事件——
 * 宁可不展开，也不展示错误的重复（app-spec P-01）。
 */

describe("parseRrule", () => {
  it("FREQ=DAILY 默认间隔 1", () => {
    expect(parseRrule("FREQ=DAILY")).toEqual({
      freq: "DAILY",
      interval: 1,
    });
  });

  it("INTERVAL 与 COUNT", () => {
    expect(parseRrule("FREQ=DAILY;INTERVAL=2;COUNT=10")).toEqual({
      freq: "DAILY",
      interval: 2,
      count: 10,
    });
  });

  it("UNTIL 的 UTC 与纯日期两种形态", () => {
    expect(parseRrule("FREQ=DAILY;UNTIL=20261231T235959Z")).toEqual({
      freq: "DAILY",
      interval: 1,
      until: { value: "2026-12-31T23:59:59.000Z", utc: true },
    });
    expect(parseRrule("FREQ=WEEKLY;UNTIL=20261231")).toEqual({
      freq: "WEEKLY",
      interval: 1,
      until: { value: "2026-12-31", utc: false },
    });
  });

  it("BYDAY 平日列表（大小写不敏感），weekday 用 0=周一 … 6=周日", () => {
    expect(parseRrule("freq=weekly;byday=mo,we,fr")).toEqual({
      freq: "WEEKLY",
      interval: 1,
      byDay: [{ weekday: 0 }, { weekday: 2 }, { weekday: 4 }],
    });
  });

  it("MONTHLY 的带序数 BYDAY（2TU 第二个周二、-1FR 最后一个周五）", () => {
    expect(parseRrule("FREQ=MONTHLY;BYDAY=2TU")).toEqual({
      freq: "MONTHLY",
      interval: 1,
      byDay: [{ ordinal: 2, weekday: 1 }],
    });
    expect(parseRrule("FREQ=MONTHLY;BYDAY=-1FR")).toEqual({
      freq: "MONTHLY",
      interval: 1,
      byDay: [{ ordinal: -1, weekday: 4 }],
    });
  });

  it("BYMONTHDAY 支持正负值", () => {
    expect(parseRrule("FREQ=MONTHLY;BYMONTHDAY=15,-1")).toEqual({
      freq: "MONTHLY",
      interval: 1,
      byMonthDay: [15, -1],
    });
  });

  it("不支持的 FREQ（秒/分/小时级）返回 undefined", () => {
    expect(parseRrule("FREQ=HOURLY;INTERVAL=6")).toBeUndefined();
    expect(parseRrule("FREQ=MINUTELY")).toBeUndefined();
    expect(parseRrule("FREQ=SECONDLY")).toBeUndefined();
  });

  it("缺失或非法的必要部分返回 undefined", () => {
    expect(parseRrule("INTERVAL=2")).toBeUndefined();
    expect(parseRrule("FREQ=WEEKLY;COUNT=0")).toBeUndefined();
    expect(parseRrule("FREQ=WEEKLY;COUNT=-3")).toBeUndefined();
    expect(parseRrule("FREQ=DAILY;INTERVAL=0")).toBeUndefined();
    expect(parseRrule("FREQ=DAILY;COUNT=abc")).toBeUndefined();
    expect(parseRrule("")).toBeUndefined();
  });

  it("BYDAY 平日名非法返回 undefined", () => {
    expect(parseRrule("FREQ=WEEKLY;BYDAY=MO,XX")).toBeUndefined();
    expect(parseRrule("FREQ=MONTHLY;BYDAY=0MO")).toBeUndefined();
  });

  it("会改变语义的未支持部分返回 undefined（BYSETPOS/BYWEEKNO/BYYEARDAY/BYMONTH）", () => {
    expect(
      parseRrule("FREQ=MONTHLY;BYDAY=MO,TU,WE;BYSETPOS=1"),
    ).toBeUndefined();
    expect(parseRrule("FREQ=YEARLY;BYWEEKNO=20")).toBeUndefined();
    expect(parseRrule("FREQ=YEARLY;BYYEARDAY=100")).toBeUndefined();
    expect(parseRrule("FREQ=YEARLY;BYMONTH=3")).toBeUndefined();
  });

  it("X- 扩展等未知但无害的部分被忽略", () => {
    expect(parseRrule("FREQ=DAILY;X-OWNER=happy")).toEqual({
      freq: "DAILY",
      interval: 1,
    });
  });

  it("展开器无法精确兑现的规则组合返回 undefined（P-01 降级）", () => {
    // YEARLY 的 BYDAY / BYMONTHDAY 语义（每年第 N 个平日 / 每月某日）未实现。
    expect(parseRrule("FREQ=YEARLY;BYDAY=1MO")).toBeUndefined();
    expect(parseRrule("FREQ=YEARLY;BYMONTHDAY=15")).toBeUndefined();
    // DAILY / WEEKLY 与 BYMONTHDAY 的组合在 RFC 中非法或无意义。
    expect(parseRrule("FREQ=DAILY;BYMONTHDAY=15")).toBeUndefined();
    expect(parseRrule("FREQ=WEEKLY;BYMONTHDAY=15")).toBeUndefined();
    // WKST 仅支持默认的周一；其他周起始会改变 INTERVAL 对齐，拒绝而不是错算。
    expect(parseRrule("FREQ=WEEKLY;INTERVAL=2;WKST=SU")).toBeUndefined();
    expect(parseRrule("FREQ=WEEKLY;INTERVAL=2;WKST=MO")).toEqual({
      freq: "WEEKLY",
      interval: 2,
    });
  });
});
