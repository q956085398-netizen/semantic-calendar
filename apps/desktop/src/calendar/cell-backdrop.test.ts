import { describe, expect, it } from "vitest";
import { cellBackdropOf } from "./cell-backdrop";
import type { ChinaDayLabel } from "../semantic/app-china-days";
import type { ChinaDaySemanticLabel } from "../semantic/app-china-festivals";
import type { FixtureDisplay } from "../semantic/metadata-resolver";

/**
 * SC-013：主背景优先级（ui-design §16.1）。
 * 「一个日期格只允许一个主背景语义」——本文件锁定「哪一个是主背景」，
 * 包括假期视觉（底色 + 大字）让位给节日 / 联赛视觉的情形（参考图同此）。
 */

const REST_DAY: ChinaDayLabel = {
  kind: "rest",
  glyph: "休",
  accent: "var(--semantic-holiday)",
  label: "国庆节假期",
  position: "第 1 天 / 共 7 天",
  run: { id: "2026-10-01", index: 0, length: 7 },
};

const MAKEUP_DAY: ChinaDayLabel = {
  kind: "makeup",
  glyph: "补",
  accent: "var(--semantic-makeup-workday)",
  label: "国庆节补班日",
};

const MID_AUTUMN: ChinaDaySemanticLabel = {
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
};

/** 清明节：同一天既是传统节日也是节气，entries[0] 是节日（§16.1 优先级 1）。 */
const QINGMING: ChinaDaySemanticLabel = {
  entries: [
    {
      kind: "festival",
      id: "qingming-festival",
      name: "清明节",
      nameEn: "Qingming Festival",
      gloss: "扫墓祭祖，踏青郊游。",
      accent: "var(--semantic-festival)",
      backgroundRef: "bg.festival.qingming-festival",
    },
    {
      kind: "solar-term",
      id: "pure-brightness",
      name: "清明",
      nameEn: "Pure Brightness",
      gloss: "气清景明，万物皆显。",
      note: "第 7 个节气",
      accent: "var(--semantic-solar-term)",
      backgroundRef: "bg.solar-term.pure-brightness",
    },
  ],
};

const FIXTURE: { fixture: FixtureDisplay } = {
  fixture: {
    competition: {
      id: "premier-league",
      label: "英超",
      nameZh: "英格兰足球超级联赛",
      nameEn: "Premier League",
      logoRef: "logo.competition.premier-league",
      colors: { primary: "#37003C", secondary: "#00FF87" },
    },
    teams: [
      {
        id: "arsenal",
        nameZh: "阿森纳",
        nameEn: "Arsenal",
        code: "ARS",
        crestRef: "crest.team.arsenal",
        colors: { primary: "#EF0107", secondary: "#FFFFFF" },
      },
      {
        id: "manchester-city",
        nameZh: "曼城",
        nameEn: "Manchester City",
        code: "MCI",
        crestRef: "crest.team.manchester-city",
        colors: { primary: "#6CABDD", secondary: "#1C2C5B" },
      },
    ],
  },
};

describe("日期格主背景优先级（SC-013 / ui-design §16.1）", () => {
  it("普通日期没有主背景：不画背景层，格子回到基线状态（§6）", () => {
    expect(cellBackdropOf({})).toEqual({ kind: "none" });
    expect(cellBackdropOf({ fixtures: [] })).toEqual({ kind: "none" });
  });

  it("节日 / 节气专属视觉优先于联赛与假期（§16.1 优先级 1）", () => {
    const backdrop = cellBackdropOf({
      chinaSemantic: MID_AUTUMN,
      dayBackdropAvailable: true,
      fixtures: [FIXTURE],
      chinaDay: REST_DAY,
    });

    expect(backdrop).toEqual({
      kind: "festival",
      ref: "bg.festival.mid-autumn-festival",
    });
  });

  it("同日两条语义取 entries[0]：清明节画节日背景，不是节气背景", () => {
    const backdrop = cellBackdropOf({
      chinaSemantic: QINGMING,
      dayBackdropAvailable: true,
    });

    expect(backdrop).toEqual({
      kind: "festival",
      ref: "bg.festival.qingming-festival",
    });
  });

  it("只有节气时画节气背景（参考图 10 月 8 日「寒露」）", () => {
    const backdrop = cellBackdropOf({
      chinaSemantic: { entries: [QINGMING.entries[1]] },
      dayBackdropAvailable: true,
    });

    expect(backdrop).toEqual({
      kind: "solar-term",
      ref: "bg.solar-term.pure-brightness",
    });
  });

  it("联赛视觉优先于假期：休假日的比赛画狮标，假期视觉整体让位（参考图 10 月 4 日）", () => {
    const backdrop = cellBackdropOf({
      fixtures: [FIXTURE],
      chinaDay: REST_DAY,
    });

    expect(backdrop).toEqual({
      kind: "league",
      competition: FIXTURE.fixture.competition,
    });
  });

  it("没有节日也没有比赛时，休假 / 补班的底色与大字成为主背景", () => {
    expect(cellBackdropOf({ chinaDay: REST_DAY })).toEqual({
      kind: "holiday",
    });
    expect(cellBackdropOf({ chinaDay: MAKEUP_DAY })).toEqual({
      kind: "holiday",
    });
  });

  it("日级语义载荷为空数组时不占主背景（缺数据 ≠ 有语义）", () => {
    expect(cellBackdropOf({ chinaSemantic: { entries: [] } })).toEqual({
      kind: "none",
    });
  });

  it("判定结果只带渲染要用的字段：判定不认识语义色，也不认识日期", () => {
    const backdrop = cellBackdropOf({ chinaDay: REST_DAY });

    expect(Object.keys(backdrop)).toEqual(["kind"]);
  });
});
