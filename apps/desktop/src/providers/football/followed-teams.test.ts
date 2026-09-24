import { describe, expect, it } from "vitest";
import { createFootballCatalog, footballCatalog } from "./football-catalog";
import {
  FOLLOWED_TEAMS_SETTING_KEY,
  followableTeams,
  readFollowedTeamIds,
  toggleFollowedTeam,
} from "./followed-teams";

/**
 * 关注球队规则（SC-016 / SPORT-006）。
 *
 * 关注状态以稳定球队 id 列表持久化，所有读取都必须先过这里：
 * 磁盘 JSON 可以被手工改写，坏值只能被丢弃，不能被猜成某支球队（P-03）。
 * 列表顺序统一规范化到“可关注球队”的顺序，保证同一组关注只对应一种快照写法。
 */

/** 名单顺序：arsenal → manchester-city → liverpool（与真实目录无关，防止硬编码）。 */
const TEST_CATALOG = createFootballCatalog({
  competitions: [
    {
      id: "test-league",
      label: "测试联赛",
      name: "测试联赛",
      nameEn: "Test League",
      aliases: [],
      accent: "var(--semantic-sport)",
      colors: { primary: "#111111", secondary: "#FFFFFF" },
      logoRef: "logo.competition.test-league",
    },
  ],
  teams: ["arsenal", "manchester-city", "liverpool"].map((id) => ({
    id,
    name: id,
    nameZh: id,
    code: id.slice(0, 3).toUpperCase(),
    aliases: [],
    colors: { primary: "#123456", secondary: "#FFFFFF" },
    crestRef: `crest.team.${id}`,
  })),
  seasons: [
    {
      id: "2025-26",
      competitionId: "test-league",
      label: "2025/26",
      teamIds: ["manchester-city", "arsenal", "liverpool"],
    },
  ],
});

describe("可关注球队（SC-016）", () => {
  it("按最新赛季名单顺序给出展示载荷，顺序与名单一致", () => {
    const teams = followableTeams(TEST_CATALOG);
    expect(teams.map((team) => team.id)).toEqual([
      "manchester-city",
      "arsenal",
      "liverpool",
    ]);
    expect(teams[0]).toEqual({
      id: "manchester-city",
      nameZh: "manchester-city",
      nameEn: "manchester-city",
      code: "MAN",
      crestRef: "crest.team.manchester-city",
      colors: { primary: "#123456", secondary: "#FFFFFF" },
    });
  });

  it("应用目录里的 20 支球队都可关注，且每项都能直接渲染", () => {
    const teams = followableTeams(footballCatalog);
    expect(teams).toHaveLength(20);
    for (const team of teams) {
      expect(team.code).not.toBe("");
      expect(team.crestRef).toBeTruthy();
      expect(team.colors.primary).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("关注列表的读取与规范化（SC-016）", () => {
  const read = (raw: unknown) => readFollowedTeamIds(TEST_CATALOG, raw);

  it("合法 id 列表按名单顺序返回，重复项去重", () => {
    expect(read(["liverpool", "arsenal", "liverpool"])).toEqual([
      "arsenal",
      "liverpool",
    ]);
  });

  it("非数组值一律视为空列表，不猜默认关注", () => {
    expect(read(undefined)).toEqual([]);
    expect(read(null)).toEqual([]);
    expect(read("arsenal")).toEqual([]);
    expect(read({ arsenal: true })).toEqual([]);
  });

  it("数组中的坏项被逐个丢弃，合法项保留", () => {
    expect(read(["arsenal", 42, null, {}, ["liverpool"], ""])).toEqual([
      "arsenal",
    ]);
  });

  it("未登记球队与带空白的写法被丢弃，不做模糊匹配", () => {
    expect(read(["barcelona", " arsenal", "arsenal "])).toEqual([]);
  });
});

describe("关注 / 取消关注（SC-016）", () => {
  const toggle = (
    current: readonly string[],
    teamId: string,
    followed: boolean,
  ) => toggleFollowedTeam(TEST_CATALOG, current, teamId, followed);

  it("关注一支球队后按名单顺序返回新列表", () => {
    expect(toggle([], "liverpool", true)).toEqual(["liverpool"]);
    expect(toggle(["liverpool"], "arsenal", true)).toEqual([
      "arsenal",
      "liverpool",
    ]);
  });

  it("取消关注只移除该球队", () => {
    expect(toggle(["arsenal", "liverpool"], "arsenal", false)).toEqual([
      "liverpool",
    ]);
  });

  it("重复关注 / 重复取消都是幂等的", () => {
    expect(toggle(["arsenal"], "arsenal", true)).toEqual(["arsenal"]);
    expect(toggle(["arsenal"], "manchester-city", false)).toEqual(["arsenal"]);
  });

  it("未登记的球队 id 不会进入关注列表", () => {
    expect(toggle(["arsenal"], "barcelona", true)).toEqual(["arsenal"]);
  });

  it("输入本身不合法时先规范化再操作", () => {
    expect(
      toggle(["liverpool", "barcelona", "liverpool"], "arsenal", true),
    ).toEqual(["arsenal", "liverpool"]);
  });

  it("设置键名固定，供持久化与 SC-018 设置页共用", () => {
    expect(FOLLOWED_TEAMS_SETTING_KEY).toBe("football.followedTeams");
  });
});
