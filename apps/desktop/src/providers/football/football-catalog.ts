import { normalizeEventTitle } from "../../normalize/title";
import {
  COMPETITIONS,
  SEASONS,
  type CompetitionMetadata,
  type SeasonRoster,
} from "./competitions";
import { TEAMS, type TeamMetadata } from "./teams";

/**
 * 英超元数据目录（SC-014）：把球队 / 联赛 / 赛季数据装配成只读查询接口。
 *
 * 与 Matcher 分离（架构 §5）：这里只回答“阿森纳是谁、属于哪个赛季、
 * 队徽引用是什么”，不回答“这个标题是不是阿森纳比赛”。
 *
 * 装配期即校验（沿用注册表的“坏数据要么拒绝、要么确定降级”原则）：
 * 数据文件写错时在启动装配阶段直接抛错，而不是让 UI 在运行期
 * 渲染出半支球队或互相矛盾的别名。
 */

export interface FootballCatalog {
  readonly competitions: readonly CompetitionMetadata[];
  readonly teams: readonly TeamMetadata[];
  readonly seasons: readonly SeasonRoster[];
  teamById(id: string): TeamMetadata | undefined;
  /** 按别名查询；输入可以是任意大小写 / 全角形态，内部统一规范化。 */
  teamByAlias(text: string): TeamMetadata | undefined;
  competitionById(id: string): CompetitionMetadata | undefined;
  /** 已登记名单中最新的赛季（不是“今天正在进行”的赛季）。 */
  latestSeason(): SeasonRoster | undefined;
  /** 某赛季参赛球队，按名单顺序解析为球队对象；未登记赛季返回空数组。 */
  rosterOf(seasonId: string): TeamMetadata[];
}

export interface FootballCatalogData {
  competitions: readonly CompetitionMetadata[];
  teams: readonly TeamMetadata[];
  seasons: readonly SeasonRoster[];
}

/** 别名索引键：与 Matcher 使用同一套标题规范化，再压成小写。 */
function aliasKey(text: string): string {
  return normalizeEventTitle(text).toLowerCase();
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function createFootballCatalog(
  data: FootballCatalogData,
): FootballCatalog {
  const { competitions, teams, seasons } = data;

  const teamById = indexBy(teams, (team) => team.id, "球队 id");
  const competitionById = indexBy(
    competitions,
    (competition) => competition.id,
    "联赛 id",
  );
  const seasonById = indexBy(seasons, (season) => season.id, "赛季 id");
  const aliasIndex = buildAliasIndex(teams);
  const codeOwners = new Map<string, string>();
  for (const team of teams) {
    const owner = codeOwners.get(team.code);
    if (owner !== undefined) {
      throw new Error(`球队代码重复：${team.code}（${owner} 与 ${team.id}）`);
    }
    codeOwners.set(team.code, team.id);
    if (!HEX_COLOR.test(team.colors.primary)) {
      throw new Error(
        `球队主色不是 #RRGGBB：${team.id} ${team.colors.primary}`,
      );
    }
    if (!HEX_COLOR.test(team.colors.secondary)) {
      throw new Error(
        `球队副色不是 #RRGGBB：${team.id} ${team.colors.secondary}`,
      );
    }
    if (
      team.colors.primary.toLowerCase() === team.colors.secondary.toLowerCase()
    ) {
      throw new Error(`球队主副色相同：${team.id}`);
    }
    if (team.crestRef === "") {
      throw new Error(`球队缺少队徽引用：${team.id}`);
    }
  }

  for (const competition of competitions) {
    if (competition.accent === "" || competition.logoRef === "") {
      throw new Error(`联赛缺少语义色或 Logo 引用：${competition.id}`);
    }
  }

  for (const season of seasons) {
    if (competitionById.get(season.competitionId) === undefined) {
      throw new Error(
        `赛季 ${season.id} 引用了未知联赛：${season.competitionId}`,
      );
    }
    if (season.teamIds.length === 0) {
      throw new Error(`赛季 ${season.id} 名单为空`);
    }
    const seen = new Set<string>();
    for (const teamId of season.teamIds) {
      if (teamById.get(teamId) === undefined) {
        throw new Error(`赛季 ${season.id} 引用了未知球队：${teamId}`);
      }
      if (seen.has(teamId)) {
        throw new Error(`赛季 ${season.id} 名单重复：${teamId}`);
      }
      seen.add(teamId);
    }
  }

  const rosterOf = (seasonId: string): TeamMetadata[] => {
    const roster = seasonById.get(seasonId);
    if (roster === undefined) {
      return [];
    }
    // 装配期已保证每个 id 都存在，这里用非空断言之外的显式过滤保持类型安全。
    return roster.teamIds.flatMap((teamId) => {
      const team = teamById.get(teamId);
      return team ? [team] : [];
    });
  };

  return {
    competitions,
    teams,
    seasons,
    teamById: (id) => teamById.get(id),
    teamByAlias: (text) => {
      const key = aliasKey(text);
      return key === "" ? undefined : aliasIndex.get(key);
    },
    competitionById: (id) => competitionById.get(id),
    // 赛季 ID 以年份开头，字符串比较即可选出最新条目，
    // 不依赖数据文件里的书写顺序。
    latestSeason: () =>
      seasons.reduce<SeasonRoster | undefined>(
        (latest, season) =>
          latest === undefined || season.id > latest.id ? season : latest,
        undefined,
      ),
    rosterOf,
  };
}

function indexBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  label: string,
): Map<string, T> {
  const index = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    if (index.has(key)) {
      throw new Error(`${label} 重复：${key}`);
    }
    index.set(key, item);
  }
  return index;
}

/**
 * 别名索引：跨球队唯一即“可确定归属”。
 *
 * 别名必须以规范化形态书写（小写、半角、无多余空格），装配期直接校验；
 * 中英文规范名由 name / nameZh 自动进入索引，不必重复列出，
 * 且规范名本身不要求小写（它是展示名）。
 */
function buildAliasIndex(
  teams: readonly TeamMetadata[],
): Map<string, TeamMetadata> {
  const index = new Map<string, TeamMetadata>();
  for (const team of teams) {
    const ownKeys = new Set<string>();
    for (const alias of team.aliases) {
      const key = aliasKey(alias);
      if (key === "") {
        throw new Error(`球队 ${team.id} 存在空别名`);
      }
      if (key !== alias) {
        throw new Error(
          `球队 ${team.id} 的别名未规范化：${alias}（应写作 ${key}）`,
        );
      }
      if (ownKeys.has(key)) {
        throw new Error(`球队 ${team.id} 别名重复：${alias}`);
      }
      ownKeys.add(key);
    }
    ownKeys.add(aliasKey(team.name));
    ownKeys.add(aliasKey(team.nameZh));

    for (const key of ownKeys) {
      const owner = index.get(key);
      if (owner !== undefined && owner.id !== team.id) {
        throw new Error(
          `别名冲突：${key}（${owner.id} 与 ${team.id}）——有歧义的简称不要收录`,
        );
      }
      index.set(key, team);
    }
  }
  return index;
}

/** 应用级默认目录：数据来自 teams.ts / competitions.ts。 */
export const footballCatalog: FootballCatalog = createFootballCatalog({
  competitions: COMPETITIONS,
  teams: TEAMS,
  seasons: SEASONS,
});
