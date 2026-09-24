import type { MarkColors } from "../../semantic/metadata-resolver";

/**
 * 英超球队字典（SC-014 / SPORT-001，app-spec §9）。
 *
 * 这里只保存“某支球队是谁”的稳定事实：稳定 ID、中英文名、别名、
 * 3 字母代码、近似球队色与队徽逻辑引用。判定“这个事件是不是英超比赛”
 * 属于 Matcher（SC-015），展示“徽标长什么样”属于 UI（SC-016），
 * 两者都不在本文件内。
 *
 * 版权边界（开发原则 §10）：仓库不携带球队徽标、联赛 Logo 等图片二进制，
 * 只保存 crestRef 逻辑引用；资源由资源包 / 用户配置单独提供，
 * 缺失时一律走 fallback（semantic/marks.ts）。
 *
 * 别名的书写规则：必须以 normalizeEventTitle 之后的小写形态给出，
 * 装配期会校验（football-catalog.ts）。像 "city" / "united" / "rovers"
 * 这类在联赛内有歧义的简称不收——宁可不识别，也不误识别（P-03）。
 */

export interface TeamMetadata {
  /** 稳定 ID，kebab-case，与 SemanticEvent.entities 中的球队 id 一致。 */
  id: string;
  /** 英文常用名。 */
  name: string;
  /** 中文常用名。 */
  nameZh: string;
  /** 3 字母代码：队徽缺失时的 fallback 缩写。 */
  code: string;
  /** 别名（含官方全称、常见简写、中文简称），必须已规范化为小写。 */
  aliases: readonly string[];
  /** 近似球队主色，用于低透明度背景与强调条（ui-design §10.1 / §17）。 */
  colors: MarkColors;
  /** 队徽逻辑引用；资源是否存在由部署决定，不保证可解析。 */
  crestRef: string;
}

/**
 * 球队字典。新增球队只需追加条目；赛季名单变化在 competitions.ts
 * 的 SEASONS 中维护，不需要改动任何识别或展示代码。
 */
export const TEAMS: readonly TeamMetadata[] = [
  {
    id: "arsenal",
    name: "Arsenal",
    nameZh: "阿森纳",
    code: "ARS",
    aliases: ["arsenal", "arsenal fc", "阿森纳"],
    colors: { primary: "#EF0107", secondary: "#FFFFFF" },
    crestRef: "crest.team.arsenal",
  },
  {
    id: "aston-villa",
    name: "Aston Villa",
    nameZh: "阿斯顿维拉",
    code: "AVL",
    aliases: ["aston villa", "aston villa fc", "villa", "阿斯顿维拉", "维拉"],
    colors: { primary: "#670E36", secondary: "#95BFE5" },
    crestRef: "crest.team.aston-villa",
  },
  {
    id: "bournemouth",
    name: "Bournemouth",
    nameZh: "伯恩茅斯",
    code: "BOU",
    aliases: ["bournemouth", "afc bournemouth", "伯恩茅斯"],
    colors: { primary: "#DA291C", secondary: "#000000" },
    crestRef: "crest.team.bournemouth",
  },
  {
    id: "brentford",
    name: "Brentford",
    nameZh: "布伦特福德",
    code: "BRE",
    aliases: ["brentford", "brentford fc", "布伦特福德"],
    colors: { primary: "#E30613", secondary: "#FFFFFF" },
    crestRef: "crest.team.brentford",
  },
  {
    id: "brighton",
    name: "Brighton & Hove Albion",
    nameZh: "布莱顿",
    code: "BHA",
    aliases: [
      "brighton & hove albion",
      "brighton and hove albion",
      "brighton",
      "布莱顿",
    ],
    colors: { primary: "#0057B8", secondary: "#FFFFFF" },
    crestRef: "crest.team.brighton",
  },
  {
    id: "burnley",
    name: "Burnley",
    nameZh: "伯恩利",
    code: "BUR",
    aliases: ["burnley", "burnley fc", "伯恩利"],
    colors: { primary: "#6C1D45", secondary: "#99D6EA" },
    crestRef: "crest.team.burnley",
  },
  {
    id: "chelsea",
    name: "Chelsea",
    nameZh: "切尔西",
    code: "CHE",
    aliases: ["chelsea", "chelsea fc", "切尔西"],
    colors: { primary: "#034694", secondary: "#FFFFFF" },
    crestRef: "crest.team.chelsea",
  },
  {
    id: "crystal-palace",
    name: "Crystal Palace",
    nameZh: "水晶宫",
    code: "CRY",
    aliases: ["crystal palace", "palace", "水晶宫"],
    colors: { primary: "#1B458F", secondary: "#C4122E" },
    crestRef: "crest.team.crystal-palace",
  },
  {
    id: "everton",
    name: "Everton",
    nameZh: "埃弗顿",
    code: "EVE",
    aliases: ["everton", "everton fc", "埃弗顿"],
    colors: { primary: "#003399", secondary: "#FFFFFF" },
    crestRef: "crest.team.everton",
  },
  {
    id: "fulham",
    name: "Fulham",
    nameZh: "富勒姆",
    code: "FUL",
    aliases: ["fulham", "fulham fc", "富勒姆"],
    colors: { primary: "#000000", secondary: "#FFFFFF" },
    crestRef: "crest.team.fulham",
  },
  {
    id: "leeds-united",
    name: "Leeds United",
    nameZh: "利兹联",
    code: "LEE",
    aliases: ["leeds united", "leeds united fc", "leeds", "利兹联", "利兹"],
    colors: { primary: "#1D428A", secondary: "#FFFFFF" },
    crestRef: "crest.team.leeds-united",
  },
  {
    id: "liverpool",
    name: "Liverpool",
    nameZh: "利物浦",
    code: "LIV",
    aliases: ["liverpool", "liverpool fc", "利物浦"],
    colors: { primary: "#C8102E", secondary: "#00B2A9" },
    crestRef: "crest.team.liverpool",
  },
  {
    id: "manchester-city",
    name: "Manchester City",
    nameZh: "曼城",
    code: "MCI",
    aliases: [
      "manchester city",
      "manchester city fc",
      "man city",
      "曼城",
      "曼彻斯特城",
    ],
    colors: { primary: "#6CABDD", secondary: "#1C2C5B" },
    crestRef: "crest.team.manchester-city",
  },
  {
    id: "manchester-united",
    name: "Manchester United",
    nameZh: "曼联",
    code: "MUN",
    aliases: [
      "manchester united",
      "manchester united fc",
      "man united",
      "man utd",
      "曼联",
      "曼彻斯特联",
    ],
    colors: { primary: "#DA291C", secondary: "#FBE122" },
    crestRef: "crest.team.manchester-united",
  },
  {
    id: "newcastle-united",
    name: "Newcastle United",
    nameZh: "纽卡斯尔联",
    code: "NEW",
    aliases: [
      "newcastle united",
      "newcastle united fc",
      "newcastle",
      "纽卡斯尔联",
      "纽卡斯尔",
    ],
    colors: { primary: "#241F20", secondary: "#FFFFFF" },
    crestRef: "crest.team.newcastle-united",
  },
  {
    id: "nottingham-forest",
    name: "Nottingham Forest",
    nameZh: "诺丁汉森林",
    code: "NFO",
    aliases: ["nottingham forest", "forest", "诺丁汉森林"],
    colors: { primary: "#DD0000", secondary: "#FFFFFF" },
    crestRef: "crest.team.nottingham-forest",
  },
  {
    id: "sunderland",
    name: "Sunderland",
    nameZh: "桑德兰",
    code: "SUN",
    aliases: ["sunderland", "sunderland afc", "桑德兰"],
    colors: { primary: "#EB172B", secondary: "#FFFFFF" },
    crestRef: "crest.team.sunderland",
  },
  {
    id: "tottenham-hotspur",
    name: "Tottenham Hotspur",
    nameZh: "托特纳姆热刺",
    code: "TOT",
    aliases: [
      "tottenham hotspur",
      "tottenham hotspur fc",
      "tottenham",
      "spurs",
      "托特纳姆热刺",
      "热刺",
    ],
    colors: { primary: "#132257", secondary: "#FFFFFF" },
    crestRef: "crest.team.tottenham-hotspur",
  },
  {
    id: "west-ham-united",
    name: "West Ham United",
    nameZh: "西汉姆联",
    code: "WHU",
    aliases: [
      "west ham united",
      "west ham united fc",
      "west ham",
      "西汉姆联",
      "西汉姆",
    ],
    colors: { primary: "#7A263A", secondary: "#1BB1E7" },
    crestRef: "crest.team.west-ham-united",
  },
  {
    id: "wolverhampton-wanderers",
    name: "Wolverhampton Wanderers",
    nameZh: "狼队",
    code: "WOL",
    aliases: [
      "wolverhampton wanderers",
      "wolverhampton wanderers fc",
      "wolverhampton",
      "wolves",
      "狼队",
    ],
    colors: { primary: "#FDB913", secondary: "#231F20" },
    crestRef: "crest.team.wolverhampton-wanderers",
  },
];
