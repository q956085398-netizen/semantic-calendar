import { describe, expect, it } from "vitest";
import {
  LUNAR_FIRST_DATE_KEY,
  LUNAR_LAST_DATE_KEY,
  leapMonthDays,
  leapMonthOf,
  lunarDateOf,
  lunarDateOfKey,
  lunarMonthDays,
  lunarYearDays,
} from "./lunar";
import { LUNAR_FIRST_YEAR, LUNAR_LAST_YEAR } from "./lunar-data";

/**
 * 农历换算测试（SC-010 验收：目标年份范围内农历日期正确、有已知日期测试样例）。
 *
 * 样例来源：香港天文台「公曆與農曆日期對照表」年表（官方历法数据）。
 * 表数据由 tools/derive-lunar-table.mjs 从同一来源逐日推导，这里挑出
 * 边界与易错日期固定下来：春节、闰月月首、以及两种历史分歧日期——
 * 旧版农历表在 1933 / 1954 / 1978 年偏差一天，天文计算实现在 2057 年
 * 偏差一天，本表两处都取官方数据。
 */

/** 官方对照表样例：日期键 → 农历（月名表示初一，其余为日名）。 */
const OFFICIAL_SAMPLES: ReadonlyArray<readonly [string, string, string]> = [
  // [日期, 农历月, 农历日]
  ["1901-02-19", "正月", "初一"], // 支持范围首日
  ["1912-02-18", "正月", "初一"],
  ["1949-01-29", "正月", "初一"],
  ["1966-01-21", "正月", "初一"], // 范围内最早的春节（1 月 21 日）
  ["1976-01-31", "正月", "初一"],
  ["1984-02-02", "正月", "初一"],
  ["2000-02-05", "正月", "初一"],
  ["2008-02-07", "正月", "初一"],
  ["2020-01-25", "正月", "初一"],
  ["2024-02-10", "正月", "初一"],
  ["2025-01-29", "正月", "初一"],
  ["2026-02-17", "正月", "初一"],
  ["2033-01-31", "正月", "初一"],
  ["2099-01-21", "正月", "初一"],
  ["2026-09-23", "八月", "十三"],
  ["2026-10-18", "九月", "初九"],
  ["2027-02-05", "十二月", "廿九"],
  ["2100-02-08", "十二月", "三十"], // 支持范围末日
  // 闰月月首（CN-001 的月份边界）
  ["1903-06-25", "闰五月", "初一"],
  ["1984-11-23", "闰十月", "初一"],
  ["2023-03-22", "闰二月", "初一"],
  ["2025-07-25", "闰六月", "初一"],
  ["2033-12-22", "闰十一月", "初一"],
  ["2099-03-22", "闰二月", "初一"],
  // 旧版农历表偏差一天的日子：官方数据为准
  ["1933-07-23", "六月", "初一"],
  ["1954-11-25", "十一月", "初一"],
  ["1978-09-02", "七月", "三十"],
  // 天文计算实现偏差一天的日子：官方数据为准（2057 年九月月首）
  ["2057-09-28", "九月", "初一"],
  ["2057-09-29", "九月", "初二"],
];

const MONTH_NAMES = [
  "正月",
  "二月",
  "三月",
  "四月",
  "五月",
  "六月",
  "七月",
  "八月",
  "九月",
  "十月",
  "十一月",
  "十二月",
];

const DAY_NAMES = [
  "初一",
  "初二",
  "初三",
  "初四",
  "初五",
  "初六",
  "初七",
  "初八",
  "初九",
  "初十",
  "十一",
  "十二",
  "十三",
  "十四",
  "十五",
  "十六",
  "十七",
  "十八",
  "十九",
  "二十",
  "廿一",
  "廿二",
  "廿三",
  "廿四",
  "廿五",
  "廿六",
  "廿七",
  "廿八",
  "廿九",
  "三十",
];

describe("公历 → 农历换算（SC-010 / CN-001）", () => {
  it("已知日期样例与官方对照表一致", () => {
    const mismatches = OFFICIAL_SAMPLES.map(([dateKey, month, day]) => {
      const lunar = lunarDateOfKey(dateKey);
      if (!lunar) return `${dateKey} 未换算（范围外？）`;
      const actual = `${lunar.isLeapMonth ? "闰" : ""}${MONTH_NAMES[lunar.month - 1]} / ${DAY_NAMES[lunar.day - 1]}`;
      const expected = `${month} / ${day}`;
      return actual === expected
        ? undefined
        : `${dateKey} 期望 ${expected} 实际 ${actual}`;
    }).filter((value): value is string => value !== undefined);

    expect(mismatches).toEqual([]);
  });

  it("支持范围边界：首日与末日可换算，范围外返回 undefined", () => {
    expect(lunarDateOfKey(LUNAR_FIRST_DATE_KEY)).toEqual({
      year: 1901,
      month: 1,
      day: 1,
      isLeapMonth: false,
    });
    expect(lunarDateOfKey(LUNAR_LAST_DATE_KEY)).toEqual({
      year: 2099,
      month: 12,
      day: 30,
      isLeapMonth: false,
    });
    expect(lunarDateOfKey("1901-02-18")).toBeUndefined();
    expect(lunarDateOfKey("1900-01-31")).toBeUndefined();
    expect(lunarDateOfKey("2100-02-09")).toBeUndefined();
    expect(lunarDateOfKey("2200-01-01")).toBeUndefined();
    // 0–99 年会被 Date.UTC 当作 19xx，这里必须按字面年份判定为范围外。
    expect(lunarDateOf(50, 1, 1)).toBeUndefined();
    expect(lunarDateOf(99, 12, 31)).toBeUndefined();
  });

  it("非法日期被拒绝，而不是静默进位", () => {
    expect(() => lunarDateOfKey("2026-2-17")).toThrow(RangeError);
    expect(() => lunarDateOfKey("20260217")).toThrow(RangeError);
    expect(() => lunarDateOfKey("2026-02-30")).toThrow(RangeError);
    expect(() => lunarDateOf(2026, 13, 1)).toThrow(RangeError);
    expect(() => lunarDateOf(2026, 1, 0)).toThrow(RangeError);
    expect(() => lunarDateOf(2026.5, 1, 1)).toThrow(RangeError);
  });
});

describe("农历年数据结构（SC-010 验收：目标年份范围内正确）", () => {
  const years: number[] = [];
  for (let year = LUNAR_FIRST_YEAR; year <= LUNAR_LAST_YEAR; year += 1) {
    years.push(year);
  }

  it("每年 12 或 13 个月，每月 29 或 30 天，年长 353–385 天", () => {
    for (const year of years) {
      let days = 0;
      for (let month = 1; month <= 12; month += 1) {
        const monthDays = lunarMonthDays(year, month);
        expect([29, 30]).toContain(monthDays);
        days += monthDays;
        if (leapMonthOf(year) === month) {
          expect([29, 30]).toContain(leapMonthDays(year));
          days += leapMonthDays(year);
        }
      }
      expect(days).toBe(lunarYearDays(year));
      expect(lunarYearDays(year)).toBeGreaterThanOrEqual(353);
      expect(lunarYearDays(year)).toBeLessThanOrEqual(385);
    }
  });

  it("闰月登记自洽：只在有闰月的年份可取，且不会出现闰正月 / 闰十二月", () => {
    for (const year of years) {
      const leap = leapMonthOf(year);
      expect(leap).toBeGreaterThanOrEqual(0);
      expect(leap).toBeLessThanOrEqual(12);
      if (leap === 0) {
        expect(leapMonthDays(year)).toBe(0);
        expect(() => lunarMonthDays(year, 1, true)).toThrow(RangeError);
        continue;
      }
      // 1901–2099 的闰月只落在二月到十一月之间（天文上闰正月 / 腊月极罕见）
      expect(leap).toBeGreaterThanOrEqual(2);
      expect(leap).toBeLessThanOrEqual(11);
      expect(() => lunarMonthDays(year, leap, true)).not.toThrow();
      // 同一年的其它月份都不是闰月
      expect(() => lunarMonthDays(year, 1, true)).toThrow(RangeError);
      expect(() => lunarMonthDays(year, 12, true)).toThrow(RangeError);
    }
  });

  it("已知闰月年份：1984 闰十月、2023 闰二月、2025 闰六月、2033 闰十一月", () => {
    expect(leapMonthOf(1984)).toBe(10);
    expect(leapMonthOf(2023)).toBe(2);
    expect(leapMonthOf(2025)).toBe(6);
    expect(leapMonthOf(2033)).toBe(11);
    expect(leapMonthOf(2026)).toBe(0);
  });

  it("春节落在 1 月 21 日 – 2 月 21 日之间（农历年的天文边界）", () => {
    const newYears: string[] = [];
    for (let year = LUNAR_FIRST_YEAR; year <= LUNAR_LAST_YEAR; year += 1) {
      const newYear = firstDayOfLunarYear(year);
      newYears.push(newYear.dateKey);
      expect(newYear.monthDay >= "01-21").toBe(true);
      expect(newYear.monthDay <= "02-21").toBe(true);
    }
    expect(newYears[0]).toBe(LUNAR_FIRST_DATE_KEY);
    expect(newYears).toHaveLength(LUNAR_LAST_YEAR - LUNAR_FIRST_YEAR + 1);
  });

  it("全范围逐日自洽：日期连续递增，月首为初一，月长与表一致", () => {
    const mismatches: string[] = [];
    let cursor = Date.UTC(1901, 1, 19);
    let checked = 0;
    for (let year = LUNAR_FIRST_YEAR; year <= LUNAR_LAST_YEAR; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        for (const isLeapMonth of leapMonthOf(year) === month
          ? [false, true]
          : [false]) {
          const days = lunarMonthDays(year, month, isLeapMonth);
          for (let day = 1; day <= days; day += 1) {
            const dateKey = new Date(cursor).toISOString().slice(0, 10);
            const lunar = lunarDateOfKey(dateKey);
            const expected = `${year}-${isLeapMonth ? "闰" : ""}${month}-${day}`;
            const actual = lunar
              ? `${lunar.year}-${lunar.isLeapMonth ? "闰" : ""}${lunar.month}-${lunar.day}`
              : "范围外";
            if (actual !== expected) {
              mismatches.push(`${dateKey} 期望 ${expected} 实际 ${actual}`);
            }
            cursor += 86_400_000;
            checked += 1;
          }
        }
      }
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
    // 支持范围天数 = 末日 − 首日 + 1
    expect(checked).toBe(
      (Date.parse(`${LUNAR_LAST_DATE_KEY}T00:00:00Z`) -
        Date.parse(`${LUNAR_FIRST_DATE_KEY}T00:00:00Z`)) /
        86_400_000 +
        1,
    );
    // 走完最后一天后，下一天已在范围外
    expect(
      lunarDateOfKey(new Date(cursor).toISOString().slice(0, 10)),
    ).toBeUndefined();
  });
});

/** 农历年首日（正月初一）的公历日期键与月日片段。 */
function firstDayOfLunarYear(year: number): {
  dateKey: string;
  monthDay: string;
} {
  let offset = 0;
  for (let previous = LUNAR_FIRST_YEAR; previous < year; previous += 1) {
    offset += lunarYearDays(previous);
  }
  const dateKey = new Date(Date.UTC(1901, 1, 19) + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { dateKey, monthDay: dateKey.slice(5) };
}
