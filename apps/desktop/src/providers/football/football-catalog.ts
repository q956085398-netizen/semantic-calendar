import { titleKey } from "../../normalize/title";
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
  /**
   * 该联赛最新一季同时收录了这些球队的名单；没有这样的名单返回 undefined。
   * Matcher（SC-015）用它把“两队同属这个联赛”变成可查的事实。
   */
  newestRosterContaining(
    competitionId: string,
    teamIds: readonly string[],
  ): SeasonRoster | undefined;
  /**
   * 识别词表：指向球队的写法快照（别名 + 中英文规范名，已规范化）。
   * Matcher（SC-015）拿它在标题里扫描球队提及；与 teamByAlias 同源，
   * 这里给出的是完整列表，teamByAlias 只回答“某个写法属于谁”。
   */
  readonly teamAliasEntries: readonly TeamAliasEntry[];
  /** 识别词表：指向联赛的写法快照（别名 + 短标签 + 中英文名）。 */
  readonly competitionAliasEntries: readonly CompetitionAliasEntry[];
}

/** 词表条目：写法 → 身份。text 已规范化（小写、半角、空白折叠）。 */
export interface TeamAliasEntry {
  text: string;
  teamId: string;
}

export interface CompetitionAliasEntry {
  text: string;
  competitionId: string;
}

export interface FootballCatalogData {
  competitions: readonly CompetitionMetadata[];
  teams: readonly TeamMetadata[];
  seasons: readonly SeasonRoster[];
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
  const teamAliases = buildAliasIndex(teams, {
    idOf: (team) => team.id,
    canonicalOf: (team) => [team.name, team.nameZh],
    aliasesOf: (team) => team.aliases,
    label: "球队",
  });
  const competitionAliases = buildAliasIndex(competitions, {
    idOf: (competition) => competition.id,
    canonicalOf: (competition) => [
      competition.label,
      competition.name,
      competition.nameEn,
    ],
    aliasesOf: (competition) => competition.aliases,
    label: "联赛",
  });
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
      const key = titleKey(text);
      return key === "" ? undefined : teamAliases.byKey.get(key);
    },
    competitionById: (id) => competitionById.get(id),
    teamAliasEntries: teamAliases.entries.map((entry) => ({
      text: entry.text,
      teamId: entry.owner.id,
    })),
    competitionAliasEntries: competitionAliases.entries.map((entry) => ({
      text: entry.text,
      competitionId: entry.owner.id,
    })),
    latestSeason: () => newestSeason(seasons),
    rosterOf,
    newestRosterContaining: (competitionId, teamIds) =>
      newestSeason(
        seasons.filter(
          (season) =>
            season.competitionId === competitionId &&
            teamIds.every((teamId) => season.teamIds.includes(teamId)),
        ),
      ),
  };
}

/** 赛季 ID 以年份开头，字符串比较即可选出最新条目，不依赖数据文件里的书写顺序。 */
function newestSeason(
  seasons: readonly SeasonRoster[],
): SeasonRoster | undefined {
  return seasons.reduce<SeasonRoster | undefined>(
    (latest, season) =>
      latest === undefined || season.id > latest.id ? season : latest,
    undefined,
  );
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

interface AliasIndex<T> {
  byKey: Map<string, T>;
  entries: readonly { text: string; owner: T }[];
}

/**
 * 别名索引：跨条目唯一即“可确定归属”。
 *
 * 别名必须以规范化形态书写（小写、半角、无多余空格），装配期直接校验；
 * 规范名（球队中英文名、联赛短标签与中英文名）自动进入索引，不必重复列出，
 * 且规范名本身不要求小写（它是展示名）。
 *
 * 索引与条目列表同源返回：Matcher（SC-015）需要拿词表在标题里扫描写法，
 * 若让它自己从数据推导，就会多出一套“什么算别名”的规则，迟早与这里漂移。
 */
function buildAliasIndex<T>(
  items: readonly T[],
  options: {
    idOf: (item: T) => string;
    canonicalOf: (item: T) => readonly string[];
    aliasesOf: (item: T) => readonly string[];
    /** 错误文案里的条目类型（“球队” / “联赛”）。 */
    label: string;
  },
): AliasIndex<T> {
  const { idOf, canonicalOf, aliasesOf, label } = options;
  const byKey = new Map<string, T>();
  const entries: { text: string; owner: T }[] = [];

  for (const item of items) {
    const id = idOf(item);
    const ownKeys = new Set<string>();
    for (const alias of aliasesOf(item)) {
      const key = titleKey(alias);
      if (key === "") {
        throw new Error(`${label} ${id} 存在空别名`);
      }
      if (key !== alias) {
        throw new Error(
          `${label} ${id} 的别名未规范化：${alias}（应写作 ${key}）`,
        );
      }
      if (ownKeys.has(key)) {
        throw new Error(`${label} ${id} 别名重复：${alias}`);
      }
      ownKeys.add(key);
    }
    for (const canonical of canonicalOf(item)) {
      const key = titleKey(canonical);
      if (key !== "") {
        ownKeys.add(key);
      }
    }

    for (const key of ownKeys) {
      const owner = byKey.get(key);
      if (owner !== undefined && idOf(owner) !== id) {
        throw new Error(
          `别名冲突：${key}（${idOf(owner)} 与 ${id}）——有歧义的简称不要收录`,
        );
      }
      byKey.set(key, item);
      entries.push({ text: key, owner: item });
    }
  }
  return { byKey, entries };
}

/** 应用级默认目录：数据来自 teams.ts / competitions.ts。 */
export const footballCatalog: FootballCatalog = createFootballCatalog({
  competitions: COMPETITIONS,
  teams: TEAMS,
  seasons: SEASONS,
});
