import type { NormalizedEvent } from "../../data/model";
import { normalizeEventTitle, titleKey } from "../../normalize/title";
import type { EventMatcher, MatchOutput } from "../../semantic/matcher-engine";
import type { CompetitionMetadata } from "./competitions";
import type { FootballCatalog } from "./football-catalog";
import { unknownTeamId } from "./unknown-team";

/** 足球对阵识别：球队身份与赛事身份分开解析。只接受明确的对阵和
 * 白名单赛程附加信息；未注明赛事使用中性足球载荷，不以国内名单猜杯赛。
 * 队徽解析由 Metadata Resolver 和本地资源层负责。
 */

export const FOOTBALL_MATCHER_ID = "football.fixture-title";

/**
 * 优先级：数值越小越先执行（引擎按 priority 升序、同级按 id 字典序）。
 * 约定 0–99 留给按日期判定的事件语义，100 起为按标题判定的语义——日期证据
 * 比标题猜测更硬，先执行。（日级语义如法定节假日、节气不经事件引擎，
 * 见 semantic/app-registry.ts。）
 */
export const FOOTBALL_MATCHER_PRIORITY = 100;

/** 恰好两支球队才构成一场比赛；多于两支按罗列处理，不做增强（P-03）。 */
const TEAM_COUNT = 2;

/** 判定依据强度；整体置信度取最弱的一环。 */
const EXPLICIT_EVIDENCE = 1;
const CONVENTION_EVIDENCE = 0.9;
const NEUTRAL_EVIDENCE = 0.8;

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

/** 赛事认定结果：是否有标题明示证据。 */
interface CompetitionMatch {
  competition: CompetitionMetadata;
  /** 未写明赛事时使用中性足球展示。 */
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
        return explicitFixtureWithUnknownTeams(
          catalog,
          normalizeEventTitle(event.normalizedTitle),
          mentions,
        );
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

      const competition = resolveCompetition(catalog, mentions);
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
          competition.explicit ? EXPLICIT_EVIDENCE : NEUTRAL_EVIDENCE,
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
 * 标题只接受两队、分隔符、赛事名、赛季、轮次和 `标签: ` 前缀。
 *
 * 只靠“两个词表里的球队 + 一个分隔符”判定是不够的：标题里的球队名可能只是
 * 一个更长短语的一部分，而短语本身讲的是别的事——
 * "Kensington Palace - Chelsea Flower Show"（展览）、
 * "Brighton - Leeds train"（车次）、"Liverpool - Everton derby tickets"。
 * 这些标题的两侧不是球队名，因此白名单之外的单词会阻止增强。
 *
 * 括号不构成豁免：括号里的词同样要能被解释（联赛名，或纯标点），
 * 否则 "Brighton - Leeds (train)" 这类括号备注又会漏进来。
 * Matchday / Round 属于赛程白名单，场地等自由文本仍留作普通事件。
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
  // 只接受对阵之后的赛季与轮次。自由文本（球票、车次、地点）仍然拒绝。
  const suffix = text.slice(right.end);
  for (const match of suffix.matchAll(
    /\b(?:season\s+)?(20\d{2})[/-](20\d{2}|\d{2})\b|\b(?:round|matchday|md)\s+[1-9]\d?\b|第[1-9]\d?轮/gu,
  )) {
    if (match[1] !== undefined) {
      const year = Number(match[1]);
      const next = Number(match[2]);
      if (next !== year + 1 && next !== (year + 1) % 100) continue;
    }
    const begin = right.end + match.index;
    allowed.push([begin, begin + match[0].length]);
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

/** 明示赛事优先。球队参赛资格不由历史名单推断，名单只服务赛季展示。 */
function resolveCompetition(
  catalog: FootballCatalog,
  mentions: readonly Mention[],
): CompetitionMatch | undefined {
  const ids = new Set(
    mentions.filter((m) => m.kind === "competition").map((m) => m.id),
  );
  if (ids.size > 1) return undefined;
  const id = [...ids][0];
  const competition = catalog.competitionById(id ?? "football");
  return competition ? { competition, explicit: id !== undefined } : undefined;
}

function orderReason(between: string, separator: Separator): string {
  return `「${between}」${separator.homeSide === "left" ? "左侧" : "右侧"}为主队`;
}

/** 未知队名仅在明确赛事和严格对阵结构下接受，避免把普通短语当作球队。 */
function explicitFixtureWithUnknownTeams(
  catalog: FootballCatalog,
  text: string,
  mentions: readonly Mention[],
): MatchOutput | null {
  const competitions = mentions.filter((m) => m.kind === "competition");
  if (competitions.length !== 1) return null;
  const competition = competitions[0];
  let body = (
    text.slice(0, competition.start) +
    " " +
    text.slice(competition.end)
  ).trim();
  body = body
    .replace(
      /\b(?:season\s+)?(20\d{2})[/-](20\d{2}|\d{2})\b/gi,
      (whole, first, second) => {
        const year = Number(first),
          next = Number(second);
        return next === year + 1 || next === (year + 1) % 100 ? " " : whole;
      },
    )
    .replace(/\b(?:round|matchday|md)\s+[1-9]\d?\b|第[1-9]\d?轮/giu, " ")
    .replace(/^[\s:：()（）\-–—]+|[\s:：()（）\-–—]+$/gu, "")
    .trim();
  const sides = /^(.+?)\s+(vs\.?|v\.?|versus|@|[-–—])\s+(.+)$/iu.exec(body);
  if (!sides) return null;
  const [, left, between, right] = sides;
  const validName = (name: string) =>
    name.length <= 80 &&
    /^[\p{L}\p{N}][\p{L}\p{N}\s.'’&/-]+$/u.test(name) &&
    !/\b(?:tickets?|train|meeting|show|stadium|training|sale|review)\b/iu.test(
      name,
    ) &&
    !/\b20\d{2}[/-]\d+/u.test(name);
  if (!validName(left) || !validName(right) || left === right) return null;
  const ids = [left, right].map(
    (name) => catalog.teamByAlias(name)?.id ?? unknownTeamId(name),
  );
  if (ids[0] === ids[1]) return null;
  const separator = classifySeparator(between.toLowerCase());
  if (!separator) return null;
  if (separator.homeSide === "right") ids.reverse();
  return {
    type: "sport.fixture",
    subtype: competition.id,
    entities: ids.map((id) => ({ type: "team", id })),
    confidence: 0.7,
    reason: `${orderReason(between, separator)}；标题标注赛事；未收录球队使用通用队徽`,
  };
}

function competitionReason(competition: CompetitionMatch): string {
  return competition.explicit
    ? `标题标注联赛「${competition.competition.label}」`
    : "标题未注明赛事，使用中性足球背景";
}
