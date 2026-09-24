// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  FOLLOWED_TEAMS_SETTING_KEY,
  listFollowableTeams,
  readFollowedTeamIds,
  toggleFollowedTeam,
} from "./app-followed-teams";

/**
 * 关注球队接线（SC-016）。
 *
 * 规则在 Provider 侧已单测；这里断言应用真正绑定的那一份目录：
 * 绑定到空目录或错误目录时，侧栏会渲染出一个空的选择器，
 * 而 Provider 的单测依然全绿。
 */

describe("应用级关注球队接线（SC-016）", () => {
  it("绑定真实球队目录：可关注集合非空且每一项都能渲染", () => {
    const teams = listFollowableTeams();
    expect(teams.length).toBeGreaterThan(0);
    for (const team of teams) {
      expect(team.nameZh).not.toBe("");
      expect(team.code).not.toBe("");
    }
  });

  it("真实球队 id 可持久化往返：写入后读回同一列表", () => {
    const [first, second] = listFollowableTeams();
    const followed = toggleFollowedTeam([], first.id, true);
    expect(followed).toEqual([first.id]);

    const roundTripped = readFollowedTeamIds(
      JSON.parse(JSON.stringify({ [FOLLOWED_TEAMS_SETTING_KEY]: followed }))[
        FOLLOWED_TEAMS_SETTING_KEY
      ],
    );
    expect(roundTripped).toEqual([first.id]);

    expect(toggleFollowedTeam(roundTripped, second.id, true)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("未知 id 与坏值不会进入关注列表", () => {
    expect(readFollowedTeamIds(["not-a-team"])).toEqual([]);
    expect(readFollowedTeamIds(42)).toEqual([]);
    expect(toggleFollowedTeam([], "not-a-team", true)).toEqual([]);
  });
});
