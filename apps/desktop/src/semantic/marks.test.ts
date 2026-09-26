import { describe, expect, it } from "vitest";
import type {
  FixtureCompetitionDisplay,
  FixtureTeamDisplay,
} from "./metadata-resolver";
import {
  NO_MARK_ASSETS,
  resolveCompetitionMark,
  resolveMark,
  resolveTeamMark,
  type MarkAssetSource,
} from "./marks";

/**
 * 标记解析（SC-014 验收：“Logo 缺失有 fallback”；SC-016 起由月格与 Inspector 消费）。
 *
 * 合成载荷覆盖全部分支：真实球队 / 联赛数据是否可解析由 Provider 侧的
 * 装配测试负责（providers/football/football-metadata-resolver.test.ts），
 * 这里只测解析规则本身——它不认识任何球队。
 */

const TEAM: FixtureTeamDisplay = {
  id: "team-a",
  nameZh: "甲队",
  nameEn: "Team A",
  code: "TMA",
  crestRef: "crest.team.a",
  colors: { primary: "#123456", secondary: "#FFFFFF" },
};

const COMPETITION: FixtureCompetitionDisplay = {
  id: "league-a",
  label: "甲联赛",
  nameZh: "甲级联赛",
  nameEn: "League A",
  logoRef: "logo.competition.a",
  colors: { primary: "#37003C", secondary: "#00FF87" },
};

describe("标记解析（SC-014 / SC-016）", () => {
  it("默认资源包不携带图片：确定性降级为代码 + 主题色", () => {
    expect(resolveTeamMark(TEAM)).toEqual({
      kind: "fallback",
      ref: "crest.team.a",
      text: "TMA",
      colors: { primary: "#123456", secondary: "#FFFFFF" },
    });
    expect(resolveTeamMark(TEAM, NO_MARK_ASSETS)).toEqual(
      resolveTeamMark(TEAM),
    );
  });

  it("资源包配置了该引用时返回资源地址", () => {
    const source: MarkAssetSource = {
      urlFor: (ref) =>
        ref === "crest.team.a" ? "/assets/crests/team-a.svg" : undefined,
    };
    expect(resolveTeamMark(TEAM, source)).toEqual({
      kind: "asset",
      ref: "crest.team.a",
      url: "/assets/crests/team-a.svg",
      // fallback 随解析结果一起交给渲染层：图片加载失败时用得上。
      fallback: {
        text: "TMA",
        colors: { primary: "#123456", secondary: "#FFFFFF" },
      },
    });
  });

  it("资源包未收录该引用：仍按 fallback 渲染，不出现破图", () => {
    const empty: MarkAssetSource = { urlFor: () => undefined };
    expect(resolveTeamMark(TEAM, empty)).toMatchObject({ kind: "fallback" });
  });

  it("资源包返回空串或抛错都只是 fallback，不会让 UI 拿到异常", () => {
    const returningEmpty: MarkAssetSource = { urlFor: () => "" };
    expect(resolveTeamMark(TEAM, returningEmpty)).toMatchObject({
      kind: "fallback",
      text: "TMA",
    });
    const throwing: MarkAssetSource = {
      urlFor: () => {
        throw new Error("资源包损坏");
      },
    };
    expect(() => resolveTeamMark(TEAM, throwing)).not.toThrow();
    expect(resolveTeamMark(TEAM, throwing)).toMatchObject({
      kind: "fallback",
      text: "TMA",
    });
  });

  it("没有队徽引用的球队（合成对象）同样可渲染", () => {
    const withoutRef: FixtureTeamDisplay = {
      id: TEAM.id,
      nameZh: TEAM.nameZh,
      nameEn: TEAM.nameEn,
      code: TEAM.code,
      colors: TEAM.colors,
    };
    expect(resolveTeamMark(withoutRef, NO_MARK_ASSETS)).toEqual({
      kind: "fallback",
      text: "TMA",
      colors: { primary: "#123456", secondary: "#FFFFFF" },
    });
  });

  it("联赛 Logo 的 fallback 是中文短标签", () => {
    expect(resolveCompetitionMark(COMPETITION)).toEqual({
      kind: "fallback",
      ref: "logo.competition.a",
      text: "甲联赛",
      colors: { primary: "#37003C", secondary: "#00FF87" },
    });
  });

  it("resolveMark 对 undefined / 空引用直接给出 fallback", () => {
    const fallback = {
      text: "甲联赛",
      colors: { primary: "#000000", secondary: "#FFFFFF" },
    };
    expect(resolveMark(undefined, fallback)).toEqual({
      kind: "fallback",
      ...fallback,
    });
    expect(resolveMark("", fallback)).toEqual({
      kind: "fallback",
      ...fallback,
    });
  });
});
