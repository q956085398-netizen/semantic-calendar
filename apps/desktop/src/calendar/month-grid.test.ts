import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildMonthGrid,
  dateFromKey,
  formatDateKey,
  parseDateKey,
  shiftDateKey,
  todayKeyFromDate,
} from "./month-grid";

describe("buildMonthGrid", () => {
  it("2026年9月：周一起始，前导8月、后延10月，共 42 格", () => {
    const grid = buildMonthGrid({ year: 2026, month: 9 });

    expect(grid.year).toBe(2026);
    expect(grid.month).toBe(9);
    expect(grid.weeks).toHaveLength(6);
    for (const week of grid.weeks) {
      expect(week).toHaveLength(7);
    }

    const cells = grid.weeks.flat();
    expect(cells).toHaveLength(42);

    // 2026-09-01 是周二：周一起始的第一格是 8月31日。
    expect(cells[0]).toMatchObject({
      dateKey: "2026-08-31",
      year: 2026,
      month: 8,
      day: 31,
      inMonth: false,
      isToday: false,
    });
    expect(cells[1].dateKey).toBe("2026-09-01");
    expect(cells[1].inMonth).toBe(true);

    // 9月共 30 天：第 30 格（index 30）是 9月30日，随后进入10月。
    expect(cells[30].dateKey).toBe("2026-09-30");
    expect(cells[31].dateKey).toBe("2026-10-01");
    expect(cells[31]).toMatchObject({ year: 2026, month: 10, day: 1 });
    expect(cells.at(-1)!.dateKey).toBe("2026-10-11");

    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(30);
  });

  it("所有格子按日连续递增，且首格为包含当月1日的周一", () => {
    const grid = buildMonthGrid({ year: 2026, month: 9 });
    const cells = grid.weeks.flat();

    for (let i = 1; i < cells.length; i += 1) {
      const previous = new Date(cells[i - 1].dateKey + "T00:00:00");
      const current = new Date(cells[i].dateKey + "T00:00:00");
      const diffDays = Math.round(
        (current.getTime() - previous.getTime()) / 86_400_000,
      );
      expect(diffDays, `${cells[i - 1].dateKey} → ${cells[i].dateKey}`).toBe(1);
    }

    const first = new Date(cells[0].dateKey + "T00:00:00");
    expect(first.getDay()).toBe(1);
    const firstOfMonth = new Date(2026, 8, 1);
    expect(first.getTime()).toBeLessThanOrEqual(firstOfMonth.getTime());
    expect(firstOfMonth.getTime() - first.getTime()).toBeLessThan(
      7 * 86_400_000,
    );
  });

  it("2027年2月：28 天恰好四周时仍补足 6 行", () => {
    // 2027-02-01 是周一。
    const grid = buildMonthGrid({ year: 2027, month: 2 });

    const cells = grid.weeks.flat();
    expect(cells).toHaveLength(42);
    expect(cells[0].dateKey).toBe("2027-02-01");
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(28);
    expect(cells.at(-1)!.dateKey).toBe("2027-03-14");
  });

  it("2026年12月：跨年尾格正确进入 2027年1月", () => {
    const grid = buildMonthGrid({ year: 2026, month: 12 });

    const cells = grid.weeks.flat();
    expect(cells[0].dateKey).toBe("2026-11-30");
    expect(cells[31].dateKey).toBe("2026-12-31");

    const firstJanuary = cells.find(
      (cell) => cell.month === 1 && cell.year === 2027,
    );
    expect(firstJanuary!.dateKey).toBe("2027-01-01");
    expect(cells.at(-1)!.dateKey).toBe("2027-01-10");
  });

  it("today 标记：仅命中一个格子", () => {
    const grid = buildMonthGrid({ year: 2026, month: 9, today: "2026-09-23" });

    const marked = grid.weeks.flat().filter((cell) => cell.isToday);
    expect(marked).toHaveLength(1);
    expect(marked[0].dateKey).toBe("2026-09-23");
    expect(marked[0].inMonth).toBe(true);
  });

  it("today 落在相邻月：前导格命中，当月格不标记", () => {
    const grid = buildMonthGrid({ year: 2026, month: 9, today: "2026-08-31" });

    const marked = grid.weeks.flat().filter((cell) => cell.isToday);
    expect(marked).toHaveLength(1);
    expect(marked[0].inMonth).toBe(false);
  });

  it("today 完全不在网格内：没有任何标记", () => {
    const grid = buildMonthGrid({ year: 2026, month: 5, today: "2026-09-23" });

    expect(grid.weeks.flat().filter((cell) => cell.isToday)).toHaveLength(0);
  });

  it("非法月份抛出 RangeError", () => {
    expect(() => buildMonthGrid({ year: 2026, month: 0 })).toThrow(RangeError);
    expect(() => buildMonthGrid({ year: 2026, month: 13 })).toThrow(RangeError);
  });

  it("非法 today 键抛出 RangeError", () => {
    expect(() =>
      buildMonthGrid({ year: 2026, month: 9, today: "2026/09/23" }),
    ).toThrow(RangeError);
  });
});

describe("formatDateKey", () => {
  it("补零到两位月/日", () => {
    expect(formatDateKey(2026, 9, 3)).toBe("2026-09-03");
    expect(formatDateKey(2027, 12, 31)).toBe("2027-12-31");
  });

  it("四位年份", () => {
    expect(formatDateKey(999, 1, 1)).toBe("0999-01-01");
  });
});

describe("todayKeyFromDate", () => {
  it("按本地日历字段提取日期键", () => {
    expect(todayKeyFromDate(new Date(2026, 8, 3, 23, 59))).toBe("2026-09-03");
    expect(todayKeyFromDate(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });
});

describe("addMonths（CAL-002 月份切换）", () => {
  it("同年内前进 / 后退", () => {
    expect(addMonths({ year: 2026, month: 9 }, 1)).toEqual({
      year: 2026,
      month: 10,
    });
    expect(addMonths({ year: 2026, month: 9 }, -1)).toEqual({
      year: 2026,
      month: 8,
    });
    expect(addMonths({ year: 2026, month: 9 }, 0)).toEqual({
      year: 2026,
      month: 9,
    });
  });

  it("跨年进位与退位", () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({
      year: 2027,
      month: 1,
    });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
    });
  });

  it("多年步进", () => {
    expect(addMonths({ year: 2026, month: 10 }, 15)).toEqual({
      year: 2028,
      month: 1,
    });
    expect(addMonths({ year: 2026, month: 2 }, -14)).toEqual({
      year: 2024,
      month: 12,
    });
  });

  it("非法步长抛出 RangeError", () => {
    expect(() => addMonths({ year: 2026, month: 9 }, 1.5)).toThrow(RangeError);
  });
});

describe("parseDateKey", () => {
  it("解析年月日", () => {
    expect(parseDateKey("2026-09-23")).toEqual({
      year: 2026,
      month: 9,
      day: 23,
    });
    expect(parseDateKey("2027-01-01")).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
  });

  it("拒绝非 YYYY-MM-DD 格式", () => {
    expect(() => parseDateKey("2026/09/23")).toThrow(RangeError);
    expect(() => parseDateKey("2026-9-3")).toThrow(RangeError);
    expect(() => parseDateKey("")).toThrow(RangeError);
  });

  it("拒绝不存在的日期", () => {
    expect(() => parseDateKey("2026-02-30")).toThrow(RangeError);
    expect(() => parseDateKey("2026-13-01")).toThrow(RangeError);
  });
});

describe("shiftDateKey（键盘基础导航）", () => {
  it("同月内 ±1 / ±7 天", () => {
    expect(shiftDateKey("2026-09-23", 1)).toBe("2026-09-24");
    expect(shiftDateKey("2026-09-23", -1)).toBe("2026-09-22");
    expect(shiftDateKey("2026-09-23", 7)).toBe("2026-09-30");
    expect(shiftDateKey("2026-09-23", -7)).toBe("2026-09-16");
  });

  it("跨月与跨年", () => {
    expect(shiftDateKey("2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftDateKey("2026-10-01", -7)).toBe("2026-09-24");
    expect(shiftDateKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDateKey("2025-12-31", 1)).toBe("2026-01-01");
  });

  it("闰年二月", () => {
    expect(shiftDateKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDateKey("2027-02-28", 1)).toBe("2027-03-01");
  });
});

describe("dateFromKey", () => {
  it("还原为本地 Date，字段与键一致", () => {
    const date = dateFromKey("2026-09-23");
    expect(date).toEqual(new Date(2026, 8, 23));
    expect(todayKeyFromDate(date)).toBe("2026-09-23");
  });

  it("拒绝非法日期键", () => {
    expect(() => dateFromKey("2026-02-30")).toThrow(RangeError);
  });
});
