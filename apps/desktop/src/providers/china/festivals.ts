import { leapMonthOf, lunarDateOfKey, lunarMonthDays } from "./lunar";
import type { LunarDate } from "./lunar";
import { SOLAR_TERMS, solarTermOfKey } from "./solar-terms";

/**
 * 传统节日（SC-012 / CN-005）。
 *
 * 只做一件事：给定公历日期，回答「这一天是什么传统节日」。日期本身不抄表，
 * 而是由农历（lunar.ts）与节气（solar-terms.ts）推导——节日名与判定规则
 * 在这里，展示文本（释义、背景引用）在 festival-labels.ts。
 *
 * 判定规则只有三种，都是历法事实，没有可解释空间：
 * - 农历固定月日（春节、中秋……）；
 * - 农历年的最后一天（除夕：腊月是 29 还是 30 天由数据决定，不写死日期）；
 * - 节气日（清明节＝清明，与 CN-006 共用同一张表）。
 *
 * 闰月不算节日：闰五月初五不是端午，闰月只是同名月份的重复。
 *
 * 收录口径：只登记日期无争议的节日。小年（北方廿三 / 南方廿四）与寒食
 * （清明前一二日）日期随地区与流派变化，宁可不显示也不猜一个（P-03）。
 * 清明节当天会同时拿到「节日」与「节气」两条语义（它是唯一一条按节气判定的
 * 节日），两条都成立，月格只画一个主背景（§16.1 由 SC-013 落实）；
 * 冬至只有节气语义，不在这张表里。
 *
 * 实现口径：日期先算成一组「日键」（dayKeysOf），节日规则也只换算成同一个
 * 键（ruleDayKey），两者相等即命中。校验与判定因此共用一套键：规则写重
 * （两个节日落在同一天）在装配期就会抛错，不会出现「校验放行、判定漏掉」。
 */

/** 节日判定规则：全部是历法事实，不含地区 / 流派选择。 */
export type FestivalRule =
  | { kind: "lunar-date"; month: number; day: number }
  | { kind: "lunar-year-end" }
  | { kind: "solar-term"; termId: string };

export interface Festival {
  /** 稳定 id：资源引用与测试用，不参与展示。 */
  id: string;
  /** 节日名（「中秋节」）。 */
  name: string;
  /** 英文名（「Mid-Autumn Festival」）：详情栏副标题。 */
  nameEn: string;
  rule: FestivalRule;
}

export interface FestivalCalendar {
  /**
   * 查询某一天的传统节日；没有节日的日子返回空数组（普通日期是常态）。
   * 日期键格式错误或不是真实存在的日期时抛 RangeError（调用方 bug）。
   */
  festivalsOfKey(dateKey: string): Festival[];
}

/** 内置节日表，顺序即详情栏展示顺序（同日多节日时的稳定次序）。 */
export const FESTIVALS: readonly Festival[] = [
  {
    id: "spring-festival",
    name: "春节",
    nameEn: "Spring Festival",
    rule: { kind: "lunar-date", month: 1, day: 1 },
  },
  {
    id: "lantern-festival",
    name: "元宵节",
    nameEn: "Lantern Festival",
    rule: { kind: "lunar-date", month: 1, day: 15 },
  },
  {
    id: "dragon-heads-rising",
    name: "龙抬头",
    nameEn: "Dragon Heads-Raising Day",
    rule: { kind: "lunar-date", month: 2, day: 2 },
  },
  {
    id: "qingming-festival",
    name: "清明节",
    nameEn: "Qingming Festival",
    rule: { kind: "solar-term", termId: "pure-brightness" },
  },
  {
    id: "dragon-boat-festival",
    name: "端午节",
    nameEn: "Dragon Boat Festival",
    rule: { kind: "lunar-date", month: 5, day: 5 },
  },
  {
    id: "qixi-festival",
    name: "七夕",
    nameEn: "Qixi Festival",
    rule: { kind: "lunar-date", month: 7, day: 7 },
  },
  {
    id: "ghost-festival",
    name: "中元节",
    nameEn: "Ghost Festival",
    rule: { kind: "lunar-date", month: 7, day: 15 },
  },
  {
    id: "mid-autumn-festival",
    name: "中秋节",
    nameEn: "Mid-Autumn Festival",
    rule: { kind: "lunar-date", month: 8, day: 15 },
  },
  {
    id: "double-ninth-festival",
    name: "重阳节",
    nameEn: "Double Ninth Festival",
    rule: { kind: "lunar-date", month: 9, day: 9 },
  },
  {
    id: "laba-festival",
    name: "腊八节",
    nameEn: "Laba Festival",
    rule: { kind: "lunar-date", month: 12, day: 8 },
  },
  {
    id: "chinese-new-years-eve",
    name: "除夕",
    nameEn: "Chinese New Year's Eve",
    rule: { kind: "lunar-year-end" },
  },
];

/**
 * 装配期校验：节日表是手写的，坏数据在这里直接抛错——
 * id / 名称 / 规则重复（两个节日落在同一天）、规则参数越界、
 * 引用了不存在的节气 id，都是数据写错，而不是运行期再降级。
 */
export function createFestivalCalendar(
  festivals: readonly Festival[],
): FestivalCalendar {
  if (festivals.length === 0) {
    throw new Error("节日数据为空");
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  const rules = new Set<string>();
  for (const festival of festivals) {
    if (festival.id === "" || festival.name === "" || festival.nameEn === "") {
      throw new Error(`节日缺少 id 或名称：${JSON.stringify(festival)}`);
    }
    if (ids.has(festival.id) || names.has(festival.name)) {
      throw new Error(`节日 id 或名称重复：${festival.name}`);
    }
    ids.add(festival.id);
    names.add(festival.name);

    const key = ruleDayKey(festival.rule);
    if (rules.has(key)) {
      throw new Error(`节日规则重复：${festival.name}（${key}）`);
    }
    rules.add(key);

    const rule = festival.rule;
    if (rule.kind === "lunar-date") {
      if (!Number.isInteger(rule.month) || rule.month < 1 || rule.month > 12) {
        throw new Error(`节日 ${festival.name} 的农历月份非法：${rule.month}`);
      }
      if (!Number.isInteger(rule.day) || rule.day < 1 || rule.day > 30) {
        throw new Error(`节日 ${festival.name} 的农历日非法：${rule.day}`);
      }
    }
    if (
      rule.kind === "solar-term" &&
      !SOLAR_TERMS.some((term) => term.id === rule.termId)
    ) {
      throw new Error(
        `节日 ${festival.name} 引用了不存在的节气：${rule.termId}`,
      );
    }
  }

  return {
    festivalsOfKey(dateKey) {
      // 先校验日期键，再判定：格式错误是调用方 bug，不应该被当成普通日期。
      const dayKeys = dayKeysOf(dateKey);
      return festivals.filter((festival) =>
        dayKeys.has(ruleDayKey(festival.rule)),
      );
    },
  };
}

/**
 * 规则 → 日键：判定的唯一依据。
 * 校验（规则重复）与查询（是否命中）都走这一个函数，两边不会各写一套。
 */
function ruleDayKey(rule: FestivalRule): string {
  switch (rule.kind) {
    case "lunar-date":
      return `lunar:${rule.month}-${rule.day}`;
    case "lunar-year-end":
      return "lunar:year-end";
    case "solar-term":
      return `solar-term:${rule.termId}`;
  }
}

/**
 * 一个公历日期拥有的全部日键。
 *
 * 农历范围外的日期没有农历键（少一个语义，不猜一个），闰月不产生农历键
 * ——闰五月初五不是端午。除夕是「农历年最后一天」这一条独立规则，
 * 不写成 `lunar:12-30`，因为腊月可能是 29 天。
 */
function dayKeysOf(dateKey: string): Set<string> {
  const keys = new Set<string>();
  const lunar = lunarDateOfKey(dateKey);
  if (lunar !== undefined && !lunar.isLeapMonth) {
    keys.add(`lunar:${lunar.month}-${lunar.day}`);
    if (isLunarYearEnd(lunar)) {
      keys.add("lunar:year-end");
    }
  }
  const term = solarTermOfKey(dateKey);
  if (term !== undefined) {
    keys.add(`solar-term:${term.id}`);
  }
  return keys;
}

/**
 * 是否农历年的最后一天（除夕）。
 *
 * 腊月是 29 还是 30 天由年数据决定，因此按「该年最后一个月的最后一天」判定，
 * 而不是写死廿九 / 三十。闰十二月（1901–2100 未出现，定义上仍可能）才是
 * 一年的最后一个月，这种情况也一并处理，避免数据扩展后悄悄漏判。
 */
function isLunarYearEnd(lunar: LunarDate): boolean {
  const lastMonthIsLeap = leapMonthOf(lunar.year) === 12;
  return (
    lunar.month === 12 &&
    lunar.isLeapMonth === lastMonthIsLeap &&
    lunar.day === lunarMonthDays(lunar.year, 12, lastMonthIsLeap)
  );
}

/** 应用级默认日历：数据来自 FESTIVALS。 */
export const chinaFestivals: FestivalCalendar =
  createFestivalCalendar(FESTIVALS);
