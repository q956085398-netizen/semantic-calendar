import { describe, expect, it } from "vitest";
import { SOLAR_TERMS } from "./solar-terms";
import {
  solarTermBackgroundRef,
  solarTermGloss,
  solarTermOrdinalText,
} from "./solar-term-labels";
import { FESTIVALS, type Festival } from "./festivals";
import { festivalBackgroundRef, festivalGloss } from "./festival-labels";

/**
 * 节日 / 节气文本测试（SC-012：本地化名称、简短说明元数据、
 * UI 背景资源引用接口）。
 *
 * 文本与资源引用是展示层的东西，因此这里锁的是口径而不是事实：
 * 释义只有一句、背景引用由 id 派生（资源包里有没有这张图由资源包决定，
 * 缺图不影响文字）。事实本身由 festivals.test.ts / solar-terms.test.ts 验证。
 */

describe("节气文本（CN-006）", () => {
  it("每个节气都有释义，寒露一句与 ui-design 示例一致", () => {
    for (const term of SOLAR_TERMS) {
      expect([term.name, solarTermGloss(term).length > 0]).toEqual([
        term.name,
        true,
      ]);
    }
    const coldDew = SOLAR_TERMS.find((term) => term.id === "cold-dew");
    if (coldDew === undefined) throw new Error("节气表缺少寒露");
    expect(solarTermGloss(coldDew)).toBe("露气寒冷，将凝结也。");
  });

  it("释义只有一句（不做百科页面）", () => {
    for (const term of SOLAR_TERMS) {
      expect([term.name, solarTermGloss(term).split("。").length - 1]).toEqual([
        term.name,
        1,
      ]);
    }
  });

  it("序号文案是补充信息，不是主标题", () => {
    const coldDew = SOLAR_TERMS[18];
    expect([coldDew.name, solarTermOrdinalText(coldDew)]).toEqual([
      "寒露",
      "第 19 个节气",
    ]);
    expect(solarTermOrdinalText(SOLAR_TERMS[0])).toBe("第 1 个节气");
    expect(solarTermOrdinalText(SOLAR_TERMS[23])).toBe("第 24 个节气");
  });

  it("背景引用由 id 派生，缺资源时只是没有背景", () => {
    expect(solarTermBackgroundRef(SOLAR_TERMS[18])).toBe(
      "bg.solar-term.cold-dew",
    );
    for (const term of SOLAR_TERMS) {
      expect([term.name, solarTermBackgroundRef(term)]).toEqual([
        term.name,
        `bg.solar-term.${term.id}`,
      ]);
    }
  });

  it("没有释义的节气直接抛错（不显示空白详情栏）", () => {
    const unknown = { ...SOLAR_TERMS[0], id: "no-such-term" };
    expect(() => solarTermGloss(unknown)).toThrow(/缺少释义/);
  });
});

describe("节日文本（CN-005）", () => {
  it("每个节日都有释义", () => {
    for (const festival of FESTIVALS) {
      expect([festival.name, festivalGloss(festival).length > 0]).toEqual([
        festival.name,
        true,
      ]);
    }
  });

  it("释义只有一句", () => {
    for (const festival of FESTIVALS) {
      expect([
        festival.name,
        festivalGloss(festival).split("。").length - 1,
      ]).toEqual([festival.name, 1]);
    }
  });

  it("背景引用由 id 派生", () => {
    const midAutumn = FESTIVALS.find(
      (festival) => festival.id === "mid-autumn-festival",
    );
    if (midAutumn === undefined) throw new Error("节日表缺少中秋节");
    expect(festivalBackgroundRef(midAutumn)).toBe(
      "bg.festival.mid-autumn-festival",
    );
    for (const festival of FESTIVALS) {
      expect([festival.name, festivalBackgroundRef(festival)]).toEqual([
        festival.name,
        `bg.festival.${festival.id}`,
      ]);
    }
  });

  it("缺少释义的节日直接抛错（不显示空白详情栏）", () => {
    const unknown: Festival = { ...FESTIVALS[0], id: "no-such-festival" };
    expect(() => festivalGloss(unknown)).toThrow(/缺少释义/);
  });
});
