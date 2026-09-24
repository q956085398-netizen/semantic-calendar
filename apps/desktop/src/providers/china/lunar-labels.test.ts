import { describe, expect, it } from "vitest";
import {
  lunarCellText,
  lunarDayLabel,
  lunarDetailText,
  lunarMonthLabel,
} from "./lunar-labels";

/**
 * 农历文本测试（SC-010 / CN-001 / ui-design §5.2、§9.2）。
 *
 * 月格只写一行：初一是农历月份边界，写月名；其余写日名。
 * 详情栏写完整写法（「农历八月廿七」）。
 */

describe("农历日名", () => {
  it("覆盖初一到三十的全部写法", () => {
    const labels = [];
    for (let day = 1; day <= 30; day += 1) {
      labels.push(lunarDayLabel(day));
    }
    expect(labels).toEqual([
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
    ]);
  });

  it("超出 1–30 抛 RangeError", () => {
    expect(() => lunarDayLabel(0)).toThrow(RangeError);
    expect(() => lunarDayLabel(31)).toThrow(RangeError);
    expect(() => lunarDayLabel(1.5)).toThrow(RangeError);
  });
});

describe("农历月名", () => {
  it("正月到十二月，闰月加前缀", () => {
    expect(lunarMonthLabel(1)).toBe("正月");
    expect(lunarMonthLabel(8)).toBe("八月");
    expect(lunarMonthLabel(11)).toBe("十一月");
    expect(lunarMonthLabel(12)).toBe("十二月");
    expect(lunarMonthLabel(4, true)).toBe("闰四月");
    expect(lunarMonthLabel(11, true)).toBe("闰十一月");
  });

  it("超出 1–12 抛 RangeError", () => {
    expect(() => lunarMonthLabel(0)).toThrow(RangeError);
    expect(() => lunarMonthLabel(13)).toThrow(RangeError);
  });
});

describe("月格简写与详情栏完整写法（CN-001）", () => {
  it("初一写月名：月份边界在月格里可见", () => {
    expect(
      lunarCellText({ year: 2026, month: 8, day: 1, isLeapMonth: false }),
    ).toBe("八月");
    expect(
      lunarCellText({ year: 2025, month: 6, day: 1, isLeapMonth: true }),
    ).toBe("闰六月");
  });

  it("其余日期写日名：一格一行，不与日期数字争位", () => {
    expect(
      lunarCellText({ year: 2026, month: 8, day: 13, isLeapMonth: false }),
    ).toBe("十三");
    expect(
      lunarCellText({ year: 2026, month: 9, day: 30, isLeapMonth: false }),
    ).toBe("三十");
  });

  it("详情栏写完整写法", () => {
    expect(
      lunarDetailText({ year: 2026, month: 8, day: 27, isLeapMonth: false }),
    ).toBe("农历八月廿七");
    expect(
      lunarDetailText({ year: 2025, month: 6, day: 1, isLeapMonth: true }),
    ).toBe("农历闰六月初一");
  });
});
