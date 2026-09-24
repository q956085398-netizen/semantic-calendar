import { describe, expect, it } from "vitest";
import { buildMonthGrid } from "../calendar/month-grid";
import { chinaDayLabelsOf } from "./app-china-days";

/**
 * 应用级节假日接线测试（SC-011 验收：连休可被 UI 识别为连续区段）。
 *
 * 这里验证的是边界本身：UI 拿到的是一份「日期键 → 展示载荷」，
 * 载荷里已经带上大字、主文案、连休位置与区段 id，UI 不需要再判日期、
 * 也不需要自己扫相邻格判断连续性。未登记安排的日期不进 Map。
 */

function cellsOf(dateKeys: readonly string[]) {
  return dateKeys.map((dateKey) => ({ dateKey }));
}

describe("月视图节假日载荷（SC-011）", () => {
  it("按日期键给出大字、主文案与连休位置", () => {
    const labels = chinaDayLabelsOf(
      cellsOf(["2026-10-01", "2026-10-03", "2026-10-10"]),
    );

    expect(labels.get("2026-10-01")).toEqual({
      kind: "rest",
      glyph: "休",
      accent: "var(--semantic-holiday)",
      label: "国庆节假期",
      position: "第 1 天 / 共 7 天",
      run: { id: "2026-10-01", index: 0, length: 7 },
    });
    expect(labels.get("2026-10-03")).toEqual({
      kind: "rest",
      glyph: "休",
      accent: "var(--semantic-holiday)",
      label: "国庆节假期",
      position: "第 3 天 / 共 7 天",
      run: { id: "2026-10-01", index: 2, length: 7 },
    });
    expect(labels.get("2026-10-10")).toEqual({
      kind: "makeup",
      glyph: "补",
      accent: "var(--semantic-makeup-workday)",
      label: "国庆节补班日",
    });
  });

  it("整月网格里同一次连休的相邻格共享区段 id", () => {
    // 2026 年 2 月网格：春节 2 月 15 日至 23 日，补班日 2 月 14 日与 28 日。
    const grid = buildMonthGrid({ year: 2026, month: 2 });
    const labels = chinaDayLabelsOf(grid.weeks.flat());

    const runIds = new Set<string>();
    for (let day = 15; day <= 23; day += 1) {
      const key = `2026-02-${String(day).padStart(2, "0")}`;
      const label = labels.get(key);
      expect(label?.kind).toBe("rest");
      expect(label?.label).toBe("春节假期");
      if (label?.run) {
        runIds.add(label.run.id);
      }
    }
    // 九天一段连休：一个 id。
    expect([...runIds]).toEqual(["2026-02-15"]);

    // 补班日：大字是「补」，没有区段。
    expect(labels.get("2026-02-14")).toEqual({
      kind: "makeup",
      glyph: "补",
      accent: "var(--semantic-makeup-workday)",
      label: "春节补班日",
    });
    expect(labels.get("2026-02-28")?.kind).toBe("makeup");
  });

  it("普通日期与未登记年份不进载荷（不猜假期）", () => {
    const labels = chinaDayLabelsOf(
      cellsOf([
        "2026-03-01",
        "2026-12-31",
        "2023-10-01",
        "2027-01-01",
        "1901-02-19",
      ]),
    );

    expect(labels.size).toBe(0);
  });

  it("网格里的跨年格照常取到元旦（2024 年安排含 2023 年 12 月）", () => {
    const labels = chinaDayLabelsOf(
      cellsOf(["2023-12-30", "2023-12-31", "2024-01-01"]),
    );

    expect(labels.get("2023-12-30")?.run).toEqual({
      id: "2023-12-30",
      index: 0,
      length: 3,
    });
    expect(labels.get("2023-12-31")?.label).toBe("元旦假期");
    expect(labels.get("2024-01-01")?.position).toBe("第 3 天 / 共 3 天");
  });
});
