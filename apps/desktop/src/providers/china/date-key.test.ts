import { describe, expect, it } from "vitest";
import {
  assertRealDate,
  epochDayOfKey,
  keyOfEpochDay,
  parseDateKey,
} from "./date-key";

/**
 * 日期键工具测试（SC-012 起三个 Provider 共用）。
 *
 * 这些函数是所有中国日历语义（农历 / 节气 / 放假安排）的入口，
 * 因此锁的是边界：格式、不存在的日期、跨年与闰年、以及
 * 「日期键 ↔ 天数」的往返。全部按 UTC 计算，与本机时区无关。
 */

describe("日期键解析与校验", () => {
  it("解析出年月日", () => {
    expect(parseDateKey("2026-10-08")).toEqual({
      year: 2026,
      month: 10,
      day: 8,
    });
  });

  it("拒绝格式错误与不存在的日期", () => {
    for (const bad of [
      "2026-2-8",
      "2026-10-8",
      "20261008",
      "2026/10/08",
      "",
      "2026-13-01",
      "2026-00-10",
      "2026-10-00",
      "2026-10-32",
      "2026-02-30",
      "2025-02-29",
      "2026-04-31",
    ]) {
      expect(() => parseDateKey(bad), bad).toThrow(RangeError);
    }
  });

  it("接受闰年的 2 月 29 日", () => {
    expect(parseDateKey("2024-02-29")).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
    expect(() => assertRealDate(2024, 2, 29)).not.toThrow();
  });

  it("年份按字面值处理，不被当作 19xx", () => {
    expect(parseDateKey("0099-01-01")).toEqual({
      year: 99,
      month: 1,
      day: 1,
    });
  });

  it("assertRealDate 对非整数与越界参数抛 RangeError", () => {
    for (const [year, month, day] of [
      [2026, 1.5, 1],
      [2026, 0, 1],
      [2026, 1, 0],
      [2026.5, 1, 1],
    ]) {
      expect(() => assertRealDate(year, month, day)).toThrow(RangeError);
    }
  });
});

describe("日期键与天数互转", () => {
  it("1970-01-01 是第 0 天", () => {
    expect(epochDayOfKey("1970-01-01")).toBe(0);
    expect(keyOfEpochDay(0)).toBe("1970-01-01");
  });

  it("往返一致（含闰年 2 月 29 日与跨年边界）", () => {
    for (const dateKey of [
      "1901-01-01",
      "1901-02-19",
      "2000-02-29",
      "2026-10-08",
      "2099-12-31",
      "2100-12-31",
    ]) {
      expect([dateKey, keyOfEpochDay(epochDayOfKey(dateKey))]).toEqual([
        dateKey,
        dateKey,
      ]);
    }
  });

  it("相邻日期相差一天", () => {
    expect(epochDayOfKey("2026-03-01") - epochDayOfKey("2026-02-28")).toBe(1);
    expect(epochDayOfKey("2024-03-01") - epochDayOfKey("2024-02-29")).toBe(1);
    expect(epochDayOfKey("2027-01-01") - epochDayOfKey("2026-12-31")).toBe(1);
  });

  it("非法日期键抛 RangeError", () => {
    expect(() => epochDayOfKey("2026-02-30")).toThrow(RangeError);
    expect(() => epochDayOfKey("2026-2-8")).toThrow(RangeError);
  });
});
