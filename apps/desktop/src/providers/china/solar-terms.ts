import { parseDateKey } from "./date-key";
import {
  SOLAR_TERM_DAY_DATA,
  SOLAR_TERM_FIRST_YEAR,
  SOLAR_TERM_LAST_YEAR,
} from "./solar-terms-data";

/**
 * 二十四节气查询（SC-012 / CN-006）。
 *
 * 只做一件事：给定公历日期，回答「这一天是哪个节气」。日期表在
 * solar-terms-data.ts（香港天文台年表推导），节气名与序号在这里，
 * 展示文本（释义、背景引用、详情栏文案）在 solar-term-labels.ts——
 * 识别（查表）与展示（写）分开，与农历（lunar.ts / lunar-labels.ts）、
 * 法定节假日（holidays.ts / holiday-labels.ts）是同一条边界。
 *
 * 不推算（P-03）：节气日期没有可用的简单公式，只有天文数据。表内没有的
 * 年份返回 undefined，界面安静地不显示节气，而不是用近似算法猜一个日期。
 * 表覆盖公历 1901–2100，与农历表（1901-02-19 – 2100-02-08）取自同一批年表；
 * 可更新策略：表只由 tools/derive-solar-terms.mjs 生成，范围扩展或数据修正
 * 时重跑工具并补官方样例（与 CN-007 的节假日数据同一条口径）。
 *
 * 节气是**日期本身的属性**：这一天是寒露，与有没有日历事件无关，因此它和
 * 农历、放假安排一样以日期键为入口，不经过事件 Matcher Engine
 * （matcher-engine.ts 的输入是 NormalizedEvent，见 app-registry.ts 的说明）。
 */

export interface SolarTerm {
  /** 稳定 id（英文 slug，如 cold-dew）：资源引用与测试用，不参与展示。 */
  id: string;
  /** 节气序号 1–24（小寒 = 1，冬至 = 24）。 */
  index: number;
  /** 节气名（「寒露」）。 */
  name: string;
  /** 英文名（「Cold Dew」）：详情栏副标题（ui-design §9.2），大小写由样式决定。 */
  nameEn: string;
  /** 所在的公历月：节气与月份的对应是固定的，因此表里只存日。 */
  month: number;
}

/**
 * 节气身份表，顺序即序号（索引 = index − 1）。
 * 名称用简体；派生表的繁体列（驚蟄 / 穀雨 / 小滿 / 芒種 / 處暑）只用于解析。
 */
export const SOLAR_TERMS: readonly SolarTerm[] = [
  { id: "minor-cold", index: 1, name: "小寒", nameEn: "Minor Cold", month: 1 },
  { id: "major-cold", index: 2, name: "大寒", nameEn: "Major Cold", month: 1 },
  {
    id: "start-of-spring",
    index: 3,
    name: "立春",
    nameEn: "Start of Spring",
    month: 2,
  },
  { id: "rain-water", index: 4, name: "雨水", nameEn: "Rain Water", month: 2 },
  {
    id: "awakening-of-insects",
    index: 5,
    name: "惊蛰",
    nameEn: "Awakening of Insects",
    month: 3,
  },
  {
    id: "spring-equinox",
    index: 6,
    name: "春分",
    nameEn: "Spring Equinox",
    month: 3,
  },
  {
    id: "pure-brightness",
    index: 7,
    name: "清明",
    nameEn: "Pure Brightness",
    month: 4,
  },
  { id: "grain-rain", index: 8, name: "谷雨", nameEn: "Grain Rain", month: 4 },
  {
    id: "start-of-summer",
    index: 9,
    name: "立夏",
    nameEn: "Start of Summer",
    month: 5,
  },
  { id: "grain-buds", index: 10, name: "小满", nameEn: "Grain Buds", month: 5 },
  {
    id: "grain-in-ear",
    index: 11,
    name: "芒种",
    nameEn: "Grain in Ear",
    month: 6,
  },
  {
    id: "summer-solstice",
    index: 12,
    name: "夏至",
    nameEn: "Summer Solstice",
    month: 6,
  },
  { id: "minor-heat", index: 13, name: "小暑", nameEn: "Minor Heat", month: 7 },
  { id: "major-heat", index: 14, name: "大暑", nameEn: "Major Heat", month: 7 },
  {
    id: "start-of-autumn",
    index: 15,
    name: "立秋",
    nameEn: "Start of Autumn",
    month: 8,
  },
  {
    id: "end-of-heat",
    index: 16,
    name: "处暑",
    nameEn: "End of Heat",
    month: 8,
  },
  { id: "white-dew", index: 17, name: "白露", nameEn: "White Dew", month: 9 },
  {
    id: "autumn-equinox",
    index: 18,
    name: "秋分",
    nameEn: "Autumn Equinox",
    month: 9,
  },
  { id: "cold-dew", index: 19, name: "寒露", nameEn: "Cold Dew", month: 10 },
  {
    id: "frost-descent",
    index: 20,
    name: "霜降",
    nameEn: "Frost's Descent",
    month: 10,
  },
  {
    id: "start-of-winter",
    index: 21,
    name: "立冬",
    nameEn: "Start of Winter",
    month: 11,
  },
  {
    id: "minor-snow",
    index: 22,
    name: "小雪",
    nameEn: "Minor Snow",
    month: 11,
  },
  {
    id: "major-snow",
    index: 23,
    name: "大雪",
    nameEn: "Major Snow",
    month: 12,
  },
  {
    id: "winter-solstice",
    index: 24,
    name: "冬至",
    nameEn: "Winter Solstice",
    month: 12,
  },
];

/** 表内可查询的首日。 */
export const SOLAR_TERM_FIRST_DATE_KEY = `${SOLAR_TERM_FIRST_YEAR}-01-01`;

/** 表内可查询的末日。 */
export const SOLAR_TERM_LAST_DATE_KEY = `${SOLAR_TERM_LAST_YEAR}-12-31`;

/**
 * 日期键 → 节气；不是节气的日期与表范围之外都返回 undefined。
 * 日期键格式错误或不是真实存在的日期时抛 RangeError（调用方 bug）。
 */
export function solarTermOfKey(dateKey: string): SolarTerm | undefined {
  const { year, month, day } = parseDateKey(dateKey);
  if (year < SOLAR_TERM_FIRST_YEAR || year > SOLAR_TERM_LAST_YEAR) {
    return undefined;
  }
  const days = SOLAR_TERM_DAY_DATA[year - SOLAR_TERM_FIRST_YEAR];
  // 每个公历月固定两个节气：月 m 对应序号 2m−1（月初）与 2m（月中）。
  const first = SOLAR_TERMS[(month - 1) * 2];
  const second = SOLAR_TERMS[(month - 1) * 2 + 1];
  if (days[first.index - 1] === day) return first;
  if (days[second.index - 1] === day) return second;
  return undefined;
}

/**
 * 装配期结构校验：数据表是生成的，这里只检查「表还完整」——
 * 行数与年份范围一致、每行 24 个日期、序号与月份对应、同月两个节气按日递增。
 * 日期本身的正确性由推导工具（tools/derive-solar-terms.mjs）与测试锁定，
 * 不在这里重复一份日期窗口表。
 */
export function assertSolarTermTable(
  terms: readonly SolarTerm[],
  data: readonly (readonly number[])[],
): void {
  if (terms.length !== 24) {
    throw new Error(`节气表应有 24 条，收到 ${terms.length}`);
  }
  const expectedYears = SOLAR_TERM_LAST_YEAR - SOLAR_TERM_FIRST_YEAR + 1;
  if (data.length !== expectedYears) {
    throw new Error(`节气日期表应有 ${expectedYears} 年，收到 ${data.length}`);
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const [position, term] of terms.entries()) {
    if (term.index !== position + 1) {
      throw new Error(`节气序号与顺序不符：${term.name}（${term.index}）`);
    }
    if (term.month !== Math.ceil(term.index / 2)) {
      throw new Error(`节气月份与序号不符：${term.name}（${term.month} 月）`);
    }
    if (term.id === "" || term.name === "" || term.nameEn === "") {
      throw new Error(`节气 ${position + 1} 缺少 id 或名称`);
    }
    if (ids.has(term.id) || names.has(term.name)) {
      throw new Error(`节气 id 或名称重复：${term.name}`);
    }
    ids.add(term.id);
    names.add(term.name);
  }
  for (const [offset, days] of data.entries()) {
    const year = SOLAR_TERM_FIRST_YEAR + offset;
    if (days.length !== terms.length) {
      throw new Error(
        `${year} 年节气日期应有 ${terms.length} 个，收到 ${days.length}`,
      );
    }
    for (const [position, day] of days.entries()) {
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        throw new Error(`${year} 年 ${terms[position].name} 日期非法：${day}`);
      }
      // 同月两个节气按日递增（月初的在前），日期表错位时能立刻发现。
      if (position % 2 === 1 && day <= days[position - 1]) {
        throw new Error(
          `${year} 年 ${terms[position].name}（${day} 日）不晚于同月前一个节气（${days[position - 1]} 日）`,
        );
      }
    }
  }
}

assertSolarTermTable(SOLAR_TERMS, SOLAR_TERM_DAY_DATA);
