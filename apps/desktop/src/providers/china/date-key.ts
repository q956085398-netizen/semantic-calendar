/**
 * 日期键的解析与公历天运算（SC-012 起共用）。
 *
 * 月视图里一切都是「日期键」：选择、事件分桶、农历、节气、放假安排都以
 * YYYY-MM-DD 为入口，因此每个中国日历 Provider 都要做同一件事——把字符串
 * 变成可比较的公历天，并拒绝格式错误或不存在的日期。
 *
 * lunar.ts 与 holidays.ts 各自带过一份私有实现（holidays.ts 那处写明「共用模块
 * 要等第三个使用方出现」）。SC-012 的节气查询是第三个使用方，于是把这段提到
 * 这里：校验只有一处，错误信息只有一套，日期键的规则不会在 Provider 之间漂移。
 *
 * 全部按 UTC 计算：农历、节气与放假安排都是东八区民用历的产物，与本机时区
 * 无关，用本地时间构造 Date 会在夏令时地区把格子算偏一天。日历网格自己的
 * 日期键（calendar/month-grid.ts）刻意用本地时间，两者不是同一个东西。
 */

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export interface CalendarDay {
  year: number;
  /** 1–12。 */
  month: number;
  /** 1–31。 */
  day: number;
}

/**
 * 日期键 → 年月日；格式错误或不是真实存在的日期时抛 RangeError
 * （调用方 bug，不应该被当成「这一天没有语义」）。
 */
export function parseDateKey(dateKey: string): CalendarDay {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) {
    throw new RangeError(`日期键必须是 YYYY-MM-DD，收到 ${dateKey}`);
  }
  const day: CalendarDay = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  assertRealDate(day.year, day.month, day.day);
  return day;
}

/**
 * 校验年月日是否是真实存在的公历日期（2026-02-30、非闰年的 02-29 都不行）；
 * 不合法时抛 RangeError。年份按字面值处理，包括会被 Date.UTC 当作 19xx 的 0–99 年。
 */
export function assertRealDate(year: number, month: number, day: number): void {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    throw new RangeError(`非法公历日期：${year}-${month}-${day}`);
  }
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  if (date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new RangeError(`非法公历日期：${year}-${month}-${day}`);
  }
}

/** 日期键 → 距 1970-01-01 的天数；按 UTC 计算，与本机时区无关。 */
export function epochDayOfKey(dateKey: string): number {
  const { year, month, day } = parseDateKey(dateKey);
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return Math.round(date.getTime() / DAY_MS);
}

/** 天数 → 日期键；只用于把已经校验过的天数还原回来。 */
export function keyOfEpochDay(epochDay: number): string {
  const date = new Date(epochDay * DAY_MS);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
