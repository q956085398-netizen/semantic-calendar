import { describe, expect, it } from "vitest";
import { wallClockToUtcIso } from "./timezone";

/**
 * SC-008 / ICS-003：TZID 墙钟时间 → UTC 瞬时。
 *
 * 预期值全部来自 IANA tzdata 的既定规则，不依赖运行机器时区：
 * - Europe/London：夏季 BST(+1)、冬季 GMT(+0)，10 月最后一个周日回拨；
 * - Asia/Shanghai：恒定 +8；
 * - America/New_York：7 月 EDT(-4)；
 * - Australia/Sydney：南半球 12 月 AEDT(+11)。
 */

describe("wallClockToUtcIso", () => {
  it("英国夏令时（BST +1）", () => {
    expect(wallClockToUtcIso("2026-07-01T12:00:00", "Europe/London")).toBe(
      "2026-07-01T11:00:00.000Z",
    );
  });

  it("英国冬令时（GMT +0）", () => {
    expect(wallClockToUtcIso("2026-12-01T12:00:00", "Europe/London")).toBe(
      "2026-12-01T12:00:00.000Z",
    );
  });

  it("上海恒定 +8，跨日回退到前一天 UTC", () => {
    expect(wallClockToUtcIso("2026-10-01T20:45:00", "Asia/Shanghai")).toBe(
      "2026-10-01T12:45:00.000Z",
    );
    expect(wallClockToUtcIso("2026-10-01T05:00:00", "Asia/Shanghai")).toBe(
      "2026-09-30T21:00:00.000Z",
    );
  });

  it("纽约夏令时（EDT -4）", () => {
    expect(wallClockToUtcIso("2026-07-04T18:00:00", "America/New_York")).toBe(
      "2026-07-04T22:00:00.000Z",
    );
  });

  it("悉尼南半球夏令时（AEDT +11）", () => {
    expect(wallClockToUtcIso("2026-12-01T09:00:00", "Australia/Sydney")).toBe(
      "2026-11-30T22:00:00.000Z",
    );
  });

  it("伦敦 2026-10-25 回拨日前后的切换规则", () => {
    // 回拨：02:00 BST → 01:00 GMT。回拨前仍按 +1，回拨后按 +0。
    expect(wallClockToUtcIso("2026-10-25T00:30:00", "Europe/London")).toBe(
      "2026-10-24T23:30:00.000Z",
    );
    expect(wallClockToUtcIso("2026-10-25T02:30:00", "Europe/London")).toBe(
      "2026-10-25T02:30:00.000Z",
    );
  });

  it("非法时区名抛错，由调用方降级为浮动时间（app-spec §13）", () => {
    expect(() => wallClockToUtcIso("2026-07-01T12:00:00", "Not/AZone")).toThrow(
      RangeError,
    );
  });

  it("非法墙钟格式抛错", () => {
    expect(() => wallClockToUtcIso("2026-07-01", "Asia/Shanghai")).toThrow();
    expect(() => wallClockToUtcIso("oops", "Asia/Shanghai")).toThrow();
  });
});
