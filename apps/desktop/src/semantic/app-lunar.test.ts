import { describe, expect, it } from "vitest";
import { lunarLabelsOf } from "./app-lunar";

/**
 * 应用级农历接线测试（SC-010）。
 *
 * 这里验证的是边界本身：UI 拿到的是一份「日期键 → 展示文本」的载荷，
 * 范围外的日期不进 Map（月视图少一行农历，而不是显示不可靠的换算）。
 */

/** 日期键 → 最小日期格输入。 */
function cellsOf(dateKeys: readonly string[]) {
  return dateKeys.map((dateKey) => ({ dateKey }));
}

describe("月视图农历载荷（SC-010）", () => {
  it("按日期键给出月格简写与详情栏完整写法", () => {
    const labels = lunarLabelsOf(cellsOf(["2026-10-10", "2026-10-18"]));

    expect(labels.get("2026-10-10")).toEqual({
      cell: "九月",
      detail: "农历九月初一",
    });
    expect(labels.get("2026-10-18")).toEqual({
      cell: "初九",
      detail: "农历九月初九",
    });
  });

  it("整月网格都能取到载荷（含跨月格）", () => {
    // 2026 年 9 月网格：8 月 31 日 – 10 月 11 日
    const dateKeys: string[] = [];
    const cursor = new Date(Date.UTC(2026, 7, 31));
    for (let index = 0; index < 42; index += 1) {
      dateKeys.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const labels = lunarLabelsOf(cellsOf(dateKeys));

    expect(labels.size).toBe(42);
    // 八月初一 = 9 月 11 日；跨月格照常有农历
    expect(labels.get("2026-09-11")).toEqual({
      cell: "八月",
      detail: "农历八月初一",
    });
    expect(labels.get("2026-08-31")).toEqual({
      cell: "十九",
      detail: "农历七月十九",
    });
  });

  it("范围外的日期不进载荷（不猜农历）", () => {
    const labels = lunarLabelsOf(
      cellsOf(["1901-02-18", "1901-02-19", "2100-02-08", "2100-02-09"]),
    );

    expect(labels.get("1901-02-18")).toBeUndefined();
    expect(labels.get("2100-02-09")).toBeUndefined();
    expect(labels.get("1901-02-19")).toEqual({
      cell: "正月",
      detail: "农历正月初一",
    });
    expect(labels.get("2100-02-08")).toEqual({
      cell: "三十",
      detail: "农历十二月三十",
    });
    expect(labels.size).toBe(2);
  });
});
