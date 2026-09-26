import type { FixtureCompetitionDisplay } from "../../semantic/metadata-resolver";

/**
 * 联赛与赛季名单（SC-014 / SPORT-001，app-spec §9）。
 *
 * 联赛条目是稳定事实（ID、名称、视觉基线色、Logo 逻辑引用）；
 * 赛季名单是随赛季变化的数据，单独放在 SEASONS 中：
 * 新赛季只需追加一条 SeasonRoster，不需要改动 Matcher（SC-015）、
 * Resolver 或任何 UI 代码。
 *
 * 名单口径：SEASONS 中只登记已确认的完整参赛名单。
 * 当前登记的 2025/26 名单来自该赛季开幕前公布的 20 支参赛球队；
 * 新赛季名单确认后作为新条目追加，latestSeason() 自然会跟随最新条目。
 * 未确认的名单不要预先写入——宁可暂缺，也不给出错误事实（P-03）。
 */

export interface CompetitionMetadata {
  id: string;
  /** 中文短标签（“英超”），用于月格徽标位与 Inspector 标题。 */
  label: string;
  /** 中文全称。 */
  name: string;
  /** 英文名。 */
  nameEn: string;
  /**
   * 别名（常见缩写等），书写规则与球队别名一致：必须已规范化为小写。
   * 短标签与中英文名由目录自动进入词表，不必在这里重复。
   */
  aliases: readonly string[];
  /**
   * 语义色 token：Resolver 输出的 accent 就取自这里（默认值是通用
   * “体育赛事”色，联赛可以有自己的强调色），由主题层最终解释。
   */
  accent: string;
  /** 联赛视觉基线色（低透明度背景用），与球队色同为近似值。 */
  colors: { primary: string; secondary: string };
  /** 联赛 Logo 逻辑引用；资源由资源包提供，缺失走 fallback。 */
  logoRef: string;
}

export interface SeasonRoster {
  /** 赛季 ID（如 "2025-26"）。 */
  id: string;
  competitionId: string;
  /** 展示用赛季标签。 */
  label: string;
  /** 该赛季参赛球队的稳定 ID，必须存在于球队字典中（装配期校验）。 */
  teamIds: readonly string[];
}

export const COMPETITIONS: readonly CompetitionMetadata[] = [
  {
    id: "premier-league",
    label: "英超",
    name: "英格兰足球超级联赛",
    nameEn: "Premier League",
    // 只收无歧义的写法：裸 "pl" 之类会在普通标题里误命中，不收录（P-03）。
    aliases: ["english premier league", "epl"],
    accent: "var(--semantic-sport)",
    colors: { primary: "#37003C", secondary: "#00FF87" },
    logoRef: "logo.competition.premier-league",
  },
];

/** 按赛季倒序登记（最新的在前）；装配期会校验赛季 ID 不重复。 */
export const SEASONS: readonly SeasonRoster[] = [
  {
    id: "2025-26",
    competitionId: "premier-league",
    label: "2025/26",
    teamIds: [
      "arsenal",
      "aston-villa",
      "bournemouth",
      "brentford",
      "brighton",
      "burnley",
      "chelsea",
      "crystal-palace",
      "everton",
      "fulham",
      "leeds-united",
      "liverpool",
      "manchester-city",
      "manchester-united",
      "newcastle-united",
      "nottingham-forest",
      "sunderland",
      "tottenham-hotspur",
      "west-ham-united",
      "wolverhampton-wanderers",
    ],
  },
];

/** 比赛展示载荷里的联赛块：Provider 从 CompetitionMetadata 投影而来。 */
export function competitionDisplay(
  competition: CompetitionMetadata,
): FixtureCompetitionDisplay {
  return {
    id: competition.id,
    label: competition.label,
    nameZh: competition.name,
    nameEn: competition.nameEn,
    logoRef: competition.logoRef,
    colors: { ...competition.colors },
  };
}
