import type { NormalizedEvent } from "../../data/model";
import { titleKey } from "../../normalize/title";
import type { EventMatcher, MatchOutput } from "../../semantic/matcher-engine";
import type { CompetitionMetadata, SeasonRoster } from "./competitions";
import type { FootballCatalog } from "./football-catalog";

/**
 * 英超比赛标题 Matcher（SC-015 / SPORT-002–003，app-spec §9）。
 *
 * 职责边界：只回答“这个标题是不是一场英超比赛、双方是谁、谁在主场”，
 * 不回答“队徽在哪、怎么显示”（Metadata Resolver，SC-014）。
 * 词表来自 FootballCatalog（别名 / 规范名 / 赛季名单），这里不硬编码球队名。
 *
 * 判定链（任一步不成立就返回 null，事件按普通事件显示，SEM-003）：
 * 1. 标题里恰好出现两支可确定归属的球队；
 * 2. 两队之间是一个已知的对阵分隔符（vs / - / @ …）；
 * 3. 标题除“两队 + 分隔符 + 联赛名 + `标签: ` 前缀”之外没有别的词；
 * 4. 联赛可确定：标题写明已登记联赛，或两队同属某个已登记赛季名单。
 *
 * 第 3 条是“不误伤”的关键：只要求“两个词表里的球队 + 一个分隔符”时，
 * 一次展览（Kensington Palace - Chelsea Flower Show）或一趟火车
 * （Brighton - Leeds train）都会被判成比赛——它们的两侧不是球队名，
 * 而是包含球队名的短语。宁可漏掉一场真比赛（P-03），
 * 也不给普通事件挂上英超。
 *
 * 主客队（SPORT-003）用 entities 顺序表达：第 0 个是主队、第 1 个是客队——
 * 这正是 SC-014 Resolver 已经依赖的接口（展示载荷按该顺序渲染）。
 * 顺序由分隔符决定：`A @ B` 明示 A 客场作战（B 为主队）；`A vs B` / `A - B`
 * 按赛程列表惯例左侧为主队。方向只靠惯例、或联赛只靠名单推断时，
 * confidence 低于 1，并把依据写进 reason（§14 可解释状态）。
 *
 * 边界：v0.1 只登记英超，因此“两队都在英超名单内”即认定为英超比赛——
 * 两支英超球队的杯赛（如足总杯）在 v0.1 也会标为英超。多联赛支持是
 * SPORT-001 的扩展点：登记新联赛与名单后，本 Matcher 的判定链自动适用。
 */

export const FOOTBALL_MATCHER_ID = "football.fixture-title";

/**
 * 优先级：数值越小越先执行（引擎按 priority 升序、同级按 id 字典序）。
 * 约定 0–99 留给按日期判定的语义（法定节假日 SC-011、节气 SC-012），
 * 100 起为按标题判定的语义——日期证据比标题猜测更硬，先执行。
 */
export const FOOTBALL_MATCHER_PRIORITY = 100;

/** 恰好两支球队才构成一场比赛；多于两支按罗列处理，不做增强（P-03）。 */
const TEAM_COUNT = 2;

/** 判定依据强度；整体置信度取最弱的一环。 */
const EXPLICIT_EVIDENCE = 1;
const CONVENTION_EVIDENCE = 0.9;
const ROSTER_EVIDENCE = 0.8;

type MentionKind = "team" | "competition";

/** 词表条目：一条可被标题命中的写法。text 由目录保证已规范化（小写）。 */
interface Needle {
  kind: MentionKind;
  id: string;
  text: string;
  /** 拉丁字母 / 数字开头的写法要求词边界，避免 "arsenal" 命中 "arsenals"。 */
  boundLeft: boolean;
  boundRight: boolean;
}

/** 扫描结果：命中位置，用于取两队之间的分隔符。 */
interface Mention {
  kind: MentionKind;
  id: string;
  start: number;
  end: number;
}

/** 对阵分隔符：决定 entities 顺序，即谁在主场。 */
interface Separator {
  homeSide: "left" | "right";
  /** 方向是否明示（`@`）而非依赖赛程列表惯例。 */
  explicit: boolean;
}

const SEPARATORS: readonly { pattern: RegExp; separator: Separator }[] = [
  // `A @ B`：美式写法，明示 A 客场作战。
  { pattern: /^@$/, separator: { homeSide: "right", explicit: true } },
  {
    // vs / vs. / v / v. / versus 与中文「对」都是“左主右客”的常见写法。
    pattern: /^(?:vs\.?|v\.?|versus|对)$/,
    separator: { homeSide: "left", explicit: false },
  },
  {
    // 短横线形式（含 en / em dash）；比分 "3-1" 不在此列，因此不会误判。
    pattern: /^[-–—]$/,
    separator: { homeSide: "left", explicit: false },
  },
];

/**
 * 词内字符只取 ASCII 字母数字：这样 "arsenals" 不会命中 "arsenal"，
 * 而中英混排（"Arsenal对曼城"）不会因为汉字也算字母而漏判。
 */
const WORD_CHAR = /[a-z0-9]/;
const ASCII_WORD_EDGE = /^[a-z0-9]/;
const ASCII_WORD_END = /[a-z0-9]$/;

/** “单词”的判定（不误伤用）：字母或数字，中文与拉丁字母一视同仁。 */
const WORD = /[\p{L}\p{N}]/u;

/** 联赛认定结果：联赛本身、命中的赛季名单与证据强度。 */
interface CompetitionMatch {
  competition: CompetitionMetadata;
  season: SeasonRoster;
  /** 标题是否写明了联赛（false 表示按名单推断）。 */
  explicit: boolean;
}

export function createFootballMatcher(catalog: FootballCatalog): EventMatcher {
  const needles = buildNeedleIndex(catalog);

  return {
    id: FOOTBALL_MATCHER_ID,
    priority: FOOTBALL_MATCHER_PRIORITY,
    match(event: NormalizedEvent): MatchOutput | null {
      // 事件可能尚未标准化（asNormalizedEvent 会让 normalizedTitle 回退到原标题），
      // 所以这里再规范化一次——与词表的比较口径同源（titleKey），且幂等。
      const text = titleKey(event.normalizedTitle);
      if (text === "") {
        return null;
      }

      const mentions = scanMentions(needles, text);
      const teams = mentions.filter((mention) => mention.kind === "team");
      if (teams.length !== TEAM_COUNT) {
        return null;
      }
      const [left, right] = teams;
      if (left.id === right.id) {
        return null;
      }

      const between = text.slice(left.end, right.start).trim();
      const separator = classifySeparator(between);
      if (separator === undefined) {
        return null;
      }

      if (!isFixtureOnlyTitle(text, mentions, left, right)) {
        return null;
      }

      const competition = resolveCompetition(catalog, mentions, [
        left.id,
        right.id,
      ]);
      if (competition === undefined) {
        return null;
      }

      const home = separator.homeSide === "left" ? left : right;
      const away = separator.homeSide === "left" ? right : left;
      return {
        type: "sport.fixture",
        subtype: competition.competition.id,
        entities: [
          { type: "team", id: home.id },
          { type: "team", id: away.id },
        ],
        confidence: Math.min(
          separator.explicit ? EXPLICIT_EVIDENCE : CONVENTION_EVIDENCE,
          competition.explicit ? EXPLICIT_EVIDENCE : ROSTER_EVIDENCE,
        ),
        reason: `${orderReason(between, separator)}；${competitionReason(competition)}`,
      };
    },
  };
}

/**
 * 词表索引：首字符 → 该字符开头的写法（长的在前）。
 *
 * 长写法优先保证同一位置只产生一个提及："Tottenham Hotspur vs Arsenal"
 * 不会同时命中 "tottenham hotspur" 与 "tottenham" 而变成三支球队。
 */
function buildNeedleIndex(catalog: FootballCatalog): Map<string, Needle[]> {
  const needles: Needle[] = [
    ...catalog.teamAliasEntries.map((entry) =>
      needleOf("team", entry.teamId, entry.text),
    ),
    ...catalog.competitionAliasEntries.map((entry) =>
      needleOf("competition", entry.competitionId, entry.text),
    ),
  ];

  const index = new Map<string, Needle[]>();
  for (const needle of [...needles].sort(
    (a, b) => b.text.length - a.text.length,
  )) {
    const first = needle.text[0];
    const bucket = index.get(first);
    if (bucket === undefined) {
      index.set(first, [needle]);
    } else {
      bucket.push(needle);
    }
  }
  return index;
}

function needleOf(kind: MentionKind, id: string, text: string): Needle {
  return {
    kind,
    id,
    text,
    boundLeft: ASCII_WORD_EDGE.test(text),
    boundRight: ASCII_WORD_END.test(text),
  };
}

/** 单趟非重叠扫描：命中即跳过该写法长度，位置与提及一一对应。 */
function scanMentions(index: Map<string, Needle[]>, text: string): Mention[] {
  const mentions: Mention[] = [];
  let position = 0;
  while (position < text.length) {
    const hit = index
      .get(text[position])
      ?.find((needle) => matchesAt(text, position, needle));
    if (hit === undefined) {
      position += 1;
      continue;
    }
    mentions.push({
      kind: hit.kind,
      id: hit.id,
      start: position,
      end: position + hit.text.length,
    });
    position += hit.text.length;
  }
  return mentions;
}

function matchesAt(text: string, position: number, needle: Needle): boolean {
  if (!text.startsWith(needle.text, position)) {
    return false;
  }
  if (needle.boundLeft && position > 0 && WORD_CHAR.test(text[position - 1])) {
    return false;
  }
  const after = text[position + needle.text.length];
  return !(needle.boundRight && after !== undefined && WORD_CHAR.test(after));
}

function classifySeparator(between: string): Separator | undefined {
  return SEPARATORS.find(({ pattern }) => pattern.test(between))?.separator;
}

/**
 * 标题除“两队 + 对阵分隔符 + 联赛名 + `标签: ` 前缀”之外不应再有别的单词。
 *
 * 只靠“两个词表里的球队 + 一个分隔符”判定是不够的：标题里的球队名可能只是
 * 一个更长短语的一部分，而短语本身讲的是别的事——
 * "Kensington Palace - Chelsea Flower Show"（展览）、
 * "Brighton - Leeds train"（车次）、"Liverpool - Everton derby tickets"。
 * 这些标题的两侧不是球队名，所以只要**别的单词**一出现就不增强（P-03：
 * 宁可漏掉一场真比赛，也不给普通事件挂上英超）。
 *
 * 括号不构成豁免：括号里的词同样要能被解释（联赛名，或纯标点），
 * 否则 "Brighton - Leeds (train)" 这类括号备注又会漏进来。代价是标题带
 * 自由文本时（"… - Matchday 12"、"(Emirates Stadium)"）会漏判——这是刻意
 * 取舍：漏判只是少一次增强，误判会给普通事件挂上英超徽标。
 */
function isFixtureOnlyTitle(
  text: string,
  mentions: readonly Mention[],
  left: Mention,
  right: Mention,
): boolean {
  const allowed: [number, number][] = [
    // 两队与其间的分隔符：这一段已经逐字校验过。
    [left.start, right.end],
  ];
  for (const mention of mentions) {
    if (mention.kind === "competition") {
      allowed.push([mention.start, mention.end]);
    }
  }
  const labelEnd = labelPrefixEnd(text, left.start);
  if (labelEnd > 0) {
    allowed.push([0, labelEnd]);
  }
  return !hasWordOutside(text, allowed);
}

/**
 * `标签: ` 前缀的结束位置。取第一个球队之前最后一个冒号，这样
 * `Re: Fwd: Arsenal vs Chelsea` 这类多段前缀也能整体按装饰处理。
 *
 * 这个豁免比括号窄得多：冒号本身不是对阵分隔符，所以
 * "Kensington Palace: Chelsea Flower Show" 依然会因为两队之间不是分隔符而落空。
 */
function labelPrefixEnd(text: string, before: number): number {
  const colon = Math.max(
    text.lastIndexOf(":", before - 1),
    text.lastIndexOf("：", before - 1),
  );
  return colon === -1 ? 0 : colon + 1;
}

/** 白名单区间之外是否还有字母 / 数字（中文也算单词，标点与表情符号不算）。 */
function hasWordOutside(
  text: string,
  spans: readonly [number, number][],
): boolean {
  let cursor = 0;
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (start > cursor && WORD.test(text.slice(cursor, start))) {
      return true;
    }
    cursor = Math.max(cursor, end);
  }
  return cursor < text.length && WORD.test(text.slice(cursor));
}

/**
 * 联赛认定：标题写明已登记联赛就用它，否则要求两队同属某个已登记赛季名单。
 * 两种情况都必须能在名单里找到两队——名单是“两队确实同属这个联赛”的证据，
 * 拿不到证据就不增强，而不是给一个可能错的联赛（P-03）。
 */
function resolveCompetition(
  catalog: FootballCatalog,
  mentions: readonly Mention[],
  [homeId, awayId]: readonly [string, string],
): CompetitionMatch | undefined {
  const named = mentions.filter((mention) => mention.kind === "competition");
  if (new Set(named.map((mention) => mention.id)).size > 1) {
    // 标题里出现两个不同的联赛名：自相矛盾，不猜（当前只登记一个联赛，
    // 多联赛登记后这条才会被触发）。
    return undefined;
  }

  const mentioned = named[0];
  if (mentioned !== undefined) {
    const competition = catalog.competitionById(mentioned.id);
    const season =
      competition === undefined
        ? undefined
        : catalog.newestRosterContaining(competition.id, [homeId, awayId]);
    return competition === undefined || season === undefined
      ? undefined
      : { competition, season, explicit: true };
  }

  const candidates = catalog.competitions.flatMap((competition) => {
    const season = catalog.newestRosterContaining(competition.id, [
      homeId,
      awayId,
    ]);
    return season === undefined
      ? []
      : [{ competition, season, explicit: false }];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

function orderReason(between: string, separator: Separator): string {
  return `「${between}」${separator.homeSide === "left" ? "左侧" : "右侧"}为主队`;
}

function competitionReason(competition: CompetitionMatch): string {
  return competition.explicit
    ? `标题标注联赛「${competition.competition.label}」`
    : `按 ${competition.season.label} 名单推断联赛`;
}
