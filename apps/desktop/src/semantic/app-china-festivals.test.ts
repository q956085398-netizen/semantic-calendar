import { describe, expect, it } from "vitest";
import { buildMonthGrid } from "../calendar/month-grid";
import { chinaSemanticLabelsOf } from "./app-china-festivals";

/**
 * 应用级节日 / 节气接线测试（SC-012）。
 *
 * 这里验证的是交给 UI 的边界：一份「日期键 → 日级语义」载荷，每条语义
 * 自带名称、英文名、一句释义、语义色与背景逻辑引用（节气另带序号），
 * UI 不判日期、不查表、不写节日名。顺序即主背景优先级（ui-design §16.1）：
 * 清明节当天同时有「清明节」与「清明」两条，节日在前。
 */

function cellsOf(dateKeys: readonly string[]) {
  return dateKeys.map((dateKey) => ({ dateKey }));
}

describe("月视图节日 / 节气载荷（SC-012）", () => {
  it("中秋节：名称、英文名、释义、语义色与背景引用一次给全", () => {
    const labels = chinaSemanticLabelsOf(cellsOf(["2026-09-25"]));

    expect(labels.get("2026-09-25")).toEqual({
      entries: [
        {
          kind: "festival",
          id: "mid-autumn-festival",
          name: "中秋节",
          nameEn: "Mid-Autumn Festival",
          gloss: "八月十五，赏月团圆，食月饼。",
          accent: "var(--semantic-festival)",
          backgroundRef: "bg.festival.mid-autumn-festival",
        },
      ],
    });
  });

  it("寒露与霜降：节气载荷带序号与专属背景引用", () => {
    const labels = chinaSemanticLabelsOf(cellsOf(["2026-10-08", "2026-10-23"]));

    expect(labels.get("2026-10-08")?.entries).toEqual([
      {
        kind: "solar-term",
        id: "cold-dew",
        name: "寒露",
        nameEn: "Cold Dew",
        gloss: "露气寒冷，将凝结也。",
        note: "第 19 个节气",
        accent: "var(--semantic-solar-term)",
        backgroundRef: "bg.solar-term.cold-dew",
      },
    ]);
    expect(labels.get("2026-10-23")?.entries[0]).toMatchObject({
      kind: "solar-term",
      name: "霜降",
      note: "第 20 个节气",
      backgroundRef: "bg.solar-term.frost-descent",
    });
  });

  it("清明节当天有两条语义，节日在前（§16.1 主背景优先级）", () => {
    const labels = chinaSemanticLabelsOf(cellsOf(["2026-04-05"]));
    const entries = labels.get("2026-04-05")?.entries ?? [];

    expect(entries.map((entry) => [entry.kind, entry.name])).toEqual([
      ["festival", "清明节"],
      ["solar-term", "清明"],
    ]);
  });

  it("普通日期不进载荷（没有语义是常态）", () => {
    const labels = chinaSemanticLabelsOf(
      cellsOf(["2026-09-24", "2026-10-07", "2026-12-23", "2026-01-01"]),
    );

    expect(labels.size).toBe(0);
  });

  it("农历 / 节气表范围之外安静地没有语义", () => {
    const labels = chinaSemanticLabelsOf(cellsOf(["1900-06-01", "2101-02-01"]));

    expect(labels.size).toBe(0);
  });

  it("整月网格里只给出有语义的日期（含跨月格）", () => {
    // 2026 年 10 月：国庆节与调休是法定节假日（SC-011），传统节日 / 节气是
    // 寒露（8 日）、重阳节（18 日）、霜降（23 日）；网格最后一周延到 11 月，
    // 因此跨月格里的立冬（11 月 7 日）也在载荷里。
    const grid = buildMonthGrid({ year: 2026, month: 10 });
    const labels = chinaSemanticLabelsOf(grid.weeks.flat());

    expect(
      [...labels.entries()].map(([dateKey, label]) => [
        dateKey,
        label.entries.map((entry) => entry.name),
      ]),
    ).toEqual([
      ["2026-10-08", ["寒露"]],
      ["2026-10-18", ["重阳节"]],
      ["2026-10-23", ["霜降"]],
      ["2026-11-07", ["立冬"]],
    ]);
  });
});
