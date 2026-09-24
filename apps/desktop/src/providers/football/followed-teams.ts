import type { FixtureTeamDisplay } from "../../semantic/metadata-resolver";
import type { FootballCatalog } from "./football-catalog";
import { teamDisplay } from "./football-metadata-resolver";

/**
 * 关注球队（SC-016 / SPORT-006，app-spec §9）。
 *
 * 关注状态是“用户选中的稳定球队 id 列表”，不保存任何展示字段：
 * 球队改名、换色、换队徽之后关注状态不需要迁移，展示始终来自目录。
 *
 * 读取边界在这里收口：设置值来自磁盘 JSON（unknown），只有目录认识的
 * id 才被接受，其余一律丢弃——宁可不显示关注，也不把坏值猜成某支球队（P-03）。
 *
 * 顺序口径：列表统一规范化到 followableTeams 的顺序（最新赛季名单顺序）。
 * 因此“可关注集合”就是这份名单：赛季名单更新时，已经不在名单内的球队
 * 会同时从可关注集合与关注列表中消失——这是名单登记的显式后果，
 * 而不是运行期静默丢数据（名单只在登记新赛季时变化）。
 */

/** 持久化键名；SC-018 的设置页与启动读取共用同一常量。 */
export const FOLLOWED_TEAMS_SETTING_KEY = "football.followedTeams";

/** 可关注球队：最新赛季名单解析为展示载荷（UI 直接渲染，不做球队名匹配）。 */
export function followableTeams(
  catalog: FootballCatalog,
): FixtureTeamDisplay[] {
  const season = catalog.latestSeason();
  const teams = season === undefined ? [] : catalog.rosterOf(season.id);
  return teams.map(teamDisplay);
}

/**
 * 设置值（磁盘 JSON）→ 关注列表。
 * 只接受目录已知的球队 id；去重、丢弃坏项、按可关注顺序重排。
 */
export function readFollowedTeamIds(
  catalog: FootballCatalog,
  raw: unknown,
): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return normalize(catalog, raw);
}

/**
 * 关注 / 取消关注一支球队，返回规范化后的新列表。
 * 未登记的 id 不产生任何变化（不新增，也不影响既有项）。
 */
export function toggleFollowedTeam(
  catalog: FootballCatalog,
  current: readonly string[],
  teamId: string,
  followed: boolean,
): string[] {
  const known = normalize(catalog, current);
  const without = known.filter((id) => id !== teamId);
  if (!followed || catalog.teamById(teamId) === undefined) {
    return without;
  }
  return normalize(catalog, [...without, teamId]);
}

/** 规范化：按可关注顺序排列、去重、丢弃未登记项与非字符串项。 */
function normalize(
  catalog: FootballCatalog,
  ids: readonly unknown[],
): string[] {
  const order = new Map(
    followableTeams(catalog).map((team, index) => [team.id, index]),
  );
  const positions = new Set<number>();
  for (const id of ids) {
    if (typeof id !== "string") {
      continue;
    }
    const position = order.get(id);
    if (position !== undefined) {
      positions.add(position);
    }
  }
  const ordered = [...order.entries()]
    .filter(([, position]) => positions.has(position))
    .sort((a, b) => a[1] - b[1]);
  return ordered.map(([id]) => id);
}
