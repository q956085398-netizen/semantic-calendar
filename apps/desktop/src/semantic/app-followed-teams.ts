import type { FixtureTeamDisplay } from "./metadata-resolver";
import { footballCatalog } from "../providers/football/football-catalog";
import {
  FOLLOWED_TEAMS_SETTING_KEY,
  followableTeams,
  readFollowedTeamIds as readFromCatalog,
  toggleFollowedTeam as toggleInCatalog,
} from "../providers/football/followed-teams";

/**
 * 应用级关注球队接线（SC-016 / SPORT-006）。
 *
 * 这是 Provider 与 UI 之间唯一的门：UI 不 import Provider 目录
 * （ui-boundary.test.ts），因此关注球队的数据与规则由这里绑定到应用目录后
 * 以展示载荷暴露出去。规则本身在 providers/football/followed-teams.ts，
 * 这里只负责“绑哪份目录”——与 app-registry 的 Matcher 注册是同一个角色。
 */

/** 持久化键名（设置页 SC-018 与启动读取共用）。 */
export { FOLLOWED_TEAMS_SETTING_KEY };

/** 可关注球队（最新赛季名单，按名单顺序）。 */
export function listFollowableTeams(): FixtureTeamDisplay[] {
  return followableTeams(footballCatalog);
}

/** 设置值（磁盘 JSON）→ 关注列表；坏值丢弃，不猜。 */
export function readFollowedTeamIds(raw: unknown): string[] {
  return readFromCatalog(footballCatalog, raw);
}

/** 关注 / 取消关注一支球队；返回规范化后的新列表。 */
export function toggleFollowedTeam(
  current: readonly string[],
  teamId: string,
  followed: boolean,
): string[] {
  return toggleInCatalog(footballCatalog, current, teamId, followed);
}
