import { assertRealDate, parseDateKey } from "./date-key";
import {
  LUNAR_FIRST_YEAR,
  LUNAR_LAST_YEAR,
  LUNAR_YEAR_DATA,
} from "./lunar-data";

/**
 * 公历 → 农历换算（SC-010 / CN-001）。
 *
 * 只做一件事：给定公历日期，给出农历年月日。农历日 / 月的显示文本在
 * lunar-labels.ts，界面接线在 semantic/app-lunar.ts——识别（算）与展示
 * （写）分开，后续节假日（SC-011）与传统节日 / 节气（SC-012）都按农历
 * 或节气日期判定，可以直接复用这里的换算结果。
 *
 * 数据边界：农历年 1901–2099（lunar-data.ts）。范围外的日期返回
 * undefined，而不是猜一个近似值——UI 少显示一行农历，好过显示错的农历。
 * 月格显示范围外的月份时，农历行自然消失（普通日期基线不受影响）。
 *
 * 全部按 UTC 计算天数差：农历是东八区民用历，与本机时区无关，
 * 用本地时间构造 Date 会在夏令时地区把格子算偏一天。
 */

export interface LunarDate {
  /** 农历年（以正月初一为界，不是公历年）。 */
  year: number;
  /** 1–12，闰月时仍取所闰的月号。 */
  month: number;
  /** 1–30。 */
  day: number;
  /** 是否闰月（如「闰四月」）。 */
  isLeapMonth: boolean;
}

/** 支持范围的首日：农历 1901 年正月初一。 */
export const LUNAR_FIRST_DATE_KEY = "1901-02-19";

/** 支持范围的末日：农历 2099 年十二月三十（次日为 2100 年正月初一）。 */
export const LUNAR_LAST_DATE_KEY = "2100-02-08";

const DAY_MS = 86_400_000;

/** 天数累计的起点：农历 1901 年正月初一，即 LUNAR_FIRST_DATE_KEY（测试断言两者同一天）。 */
const EPOCH_MS = Date.UTC(1901, 1, 19);

/** 一年 12 个月按 29 天计的基础天数；大月与闰月在此之上累加。 */
const BASE_YEAR_DAYS = 348;

/** 闰月号：0 = 无闰月，1–12 = 闰几月。 */
export function leapMonthOf(lunarYear: number): number {
  return lunarYearData(lunarYear) & 0xf;
}

/** 闰月天数；无闰月时为 0。 */
export function leapMonthDays(lunarYear: number): number {
  if (leapMonthOf(lunarYear) === 0) return 0;
  return (lunarYearData(lunarYear) & 0x1_0000) === 0 ? 29 : 30;
}

/** 某月天数：29 或 30。 */
export function lunarMonthDays(
  lunarYear: number,
  month: number,
  isLeapMonth = false,
): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`农历月份必须是 1–12，收到 ${month}`);
  }
  if (isLeapMonth) {
    if (leapMonthOf(lunarYear) !== month) {
      throw new RangeError(`农历 ${lunarYear} 年没有闰 ${month} 月`);
    }
    return leapMonthDays(lunarYear);
  }
  return (lunarYearData(lunarYear) & (0x8000 >> (month - 1))) === 0 ? 29 : 30;
}

/** 一年总天数：353–385（平年 353–355，闰年 383–385）。 */
export function lunarYearDays(lunarYear: number): number {
  let bigMonths = 0;
  const data = lunarYearData(lunarYear);
  for (let month = 1; month <= 12; month += 1) {
    if ((data & (0x8000 >> (month - 1))) !== 0) bigMonths += 1;
  }
  return BASE_YEAR_DAYS + bigMonths + leapMonthDays(lunarYear);
}

/**
 * 公历 → 农历。范围外（早于 1901-02-19 或晚于 2100-02-08）返回 undefined。
 */
export function lunarDateOf(
  year: number,
  month: number,
  day: number,
): LunarDate | undefined {
  const offset = daysFromEpoch(year, month, day);
  if (offset < 0) return undefined;

  let remaining = offset;
  for (
    let lunarYear = LUNAR_FIRST_YEAR;
    lunarYear <= LUNAR_LAST_YEAR;
    lunarYear += 1
  ) {
    const yearDays = lunarYearDays(lunarYear);
    if (remaining < yearDays) return monthDayOf(lunarYear, remaining);
    remaining -= yearDays;
  }
  return undefined;
}

/** 日期键 YYYY-MM-DD → 农历；格式错误抛 RangeError，范围外返回 undefined。 */
export function lunarDateOfKey(dateKey: string): LunarDate | undefined {
  const { year, month, day } = parseDateKey(dateKey);
  return lunarDateOf(year, month, day);
}

/**
 * 距离农历 1901 年正月初一的天数（可为负，范围判定交给调用方）。
 * 不存在的日期（2026-02-30、非闰年的 02-29）抛 RangeError，而不是被 Date
 * 静默进位；年份一律按字面值处理，包括会被 Date.UTC 当作 19xx 的 0–99 年。
 * 日期合法性校验与节假日、节气共用 date-key.ts，三个 Provider 不会各有一套规则。
 */
function daysFromEpoch(year: number, month: number, day: number): number {
  assertRealDate(year, month, day);
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return Math.round((date.getTime() - EPOCH_MS) / DAY_MS);
}

/** 年内偏移天数 → 农历月日；闰月插在其月号之后，与民用历一致。 */
function monthDayOf(lunarYear: number, offset: number): LunarDate {
  let remaining = offset;
  for (let month = 1; month <= 12; month += 1) {
    const days = lunarMonthDays(lunarYear, month);
    if (remaining < days) {
      return { year: lunarYear, month, day: remaining + 1, isLeapMonth: false };
    }
    remaining -= days;

    if (leapMonthOf(lunarYear) === month) {
      const leapDays = leapMonthDays(lunarYear);
      if (remaining < leapDays) {
        return {
          year: lunarYear,
          month,
          day: remaining + 1,
          isLeapMonth: true,
        };
      }
      remaining -= leapDays;
    }
  }
  // 表内数据自洽时不会走到这里（年长 = 各月天数之和）。
  throw new RangeError(
    `农历 ${lunarYear} 年数据异常：偏移 ${offset} 天超出年长`,
  );
}

function lunarYearData(lunarYear: number): number {
  if (
    !Number.isInteger(lunarYear) ||
    lunarYear < LUNAR_FIRST_YEAR ||
    lunarYear > LUNAR_LAST_YEAR
  ) {
    throw new RangeError(
      `农历年必须在 ${LUNAR_FIRST_YEAR}–${LUNAR_LAST_YEAR} 之间，收到 ${lunarYear}`,
    );
  }
  return LUNAR_YEAR_DATA[lunarYear - LUNAR_FIRST_YEAR];
}
