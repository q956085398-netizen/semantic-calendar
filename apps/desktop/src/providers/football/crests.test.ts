import { describe, expect, it } from "vitest";
import type { FixtureTeamDisplay } from "../../semantic/metadata-resolver";
import {
  NO_CREST_ASSETS,
  resolveCompetitionLogo,
  resolveMark,
  resolveTeamCrest,
  type CrestAssetSource,
} from "./crests";
import { competitionDisplay, COMPETITIONS } from "./competitions";
import { footballCatalog } from "./football-catalog";
import { teamDisplay } from "./football-metadata-resolver";

const ARSENAL: FixtureTeamDisplay = {
  id: "arsenal",
  nameZh: "阿森纳",
  nameEn: "Arsenal",
  code: "ARS",
  crestRef: "crest.team.arsenal",
  colors: { primary: "#EF0107", secondary: "#FFFFFF" },
};

/** 从字典取真实球队并投影为展示对象（测试数据缺失时直接失败）。 */
function displayOf(teamId: string): FixtureTeamDisplay {
  const team = footballCatalog.teamById(teamId);
  if (team === undefined) {
    throw new Error(`测试数据缺少球队：${teamId}`);
  }
  return teamDisplay(team);
}

describe("队徽 / Logo 资源解析（SC-014 验收：Logo 缺失有 fallback）", () => {
  it("默认资源包不携带图片：确定性降级为代码 + 球队色", () => {
    expect(resolveTeamCrest(ARSENAL)).toEqual({
      kind: "fallback",
      ref: "crest.team.arsenal",
      text: "ARS",
      colors: { primary: "#EF0107", secondary: "#FFFFFF" },
    });
  });

  it("资源包配置了该引用时返回资源地址", () => {
    const source: CrestAssetSource = {
      urlFor: (ref) =>
        ref === "crest.team.arsenal" ? "/assets/crests/arsenal.svg" : undefined,
    };
    expect(resolveTeamCrest(ARSENAL, source)).toEqual({
      kind: "asset",
      ref: "crest.team.arsenal",
      url: "/assets/crests/arsenal.svg",
    });
  });

  it("资源包未收录该引用：仍按 fallback 渲染，不出现破图", () => {
    const empty: CrestAssetSource = { urlFor: () => undefined };
    expect(resolveTeamCrest(ARSENAL, empty)).toMatchObject({
      kind: "fallback",
    });
  });

  it("资源包返回空串或抛错都只是 fallback，不会让 UI 拿到异常", () => {
    const returningEmpty: CrestAssetSource = { urlFor: () => "" };
    expect(resolveTeamCrest(ARSENAL, returningEmpty)).toMatchObject({
      kind: "fallback",
      text: "ARS",
    });
    const throwing: CrestAssetSource = {
      urlFor: () => {
        throw new Error("资源包损坏");
      },
    };
    expect(() => resolveTeamCrest(ARSENAL, throwing)).not.toThrow();
    expect(resolveTeamCrest(ARSENAL, throwing)).toMatchObject({
      kind: "fallback",
      text: "ARS",
    });
  });

  it("没有队徽引用的球队（合成对象）同样可渲染", () => {
    const withoutRef: FixtureTeamDisplay = {
      id: ARSENAL.id,
      nameZh: ARSENAL.nameZh,
      nameEn: ARSENAL.nameEn,
      code: ARSENAL.code,
      colors: ARSENAL.colors,
    };
    expect(resolveTeamCrest(withoutRef, NO_CREST_ASSETS)).toEqual({
      kind: "fallback",
      text: "ARS",
      colors: { primary: "#EF0107", secondary: "#FFFFFF" },
    });
  });

  it("联赛 Logo 的 fallback 是中文短标签", () => {
    const competition = competitionDisplay(COMPETITIONS[0]);
    expect(resolveCompetitionLogo(competition)).toEqual({
      kind: "fallback",
      ref: "logo.competition.premier-league",
      text: "英超",
      colors: { primary: "#37003C", secondary: "#00FF87" },
    });
  });

  it("解析不依赖元数据来源：字典里的真实球队可直接得到 fallback 缩写", () => {
    expect(resolveTeamCrest(displayOf("arsenal"))).toMatchObject({
      kind: "fallback",
      text: "ARS",
    });
    expect(resolveTeamCrest(displayOf("manchester-city"))).toMatchObject({
      kind: "fallback",
      text: "MCI",
    });
  });

  it("resolveMark 对 undefined / 空引用直接给出 fallback", () => {
    const fallback = {
      text: "英超",
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
