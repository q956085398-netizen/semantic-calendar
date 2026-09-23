/**
 * 日期键的 UTC 分量算术（occurrences 与 event-buckets 共用）。
 *
 * 全部以 UTC 分量构造与读取，跨月 / 跨年 / 闰年由 Date 归一化，
 * 不经过任何本地时区。setUTCFullYear 规避 Date 构造器把 0–99 年
 * 隐式映射到 1900+ 年的经典陷阱，保证任意四位年份语义正确。
 */

import { formatDateKey } from "./month-grid";

/** 用 UTC 分量构造 Date（month 为 1–12；day 可越界，由 Date 归一化）。 */
export function utcDateOf(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

/** 日期键的当日 UTC 零点。 */
export function utcMidnight(day: string): Date {
  return utcDateOf(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)),
    Number(day.slice(8, 10)),
  );
}

/** 日期键按天步进（可负）。 */
export function shiftDayKey(day: string, days: number): string {
  const shifted = utcDateOf(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)),
    Number(day.slice(8, 10)) + days,
  );
  return formatDateKey(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/** 两个日期键相差的天数（可负；UTC 计数，规避夏令时）。 */
export function daysBetweenKeys(from: string, to: string): number {
  return Math.round(
    (utcMidnight(to).getTime() - utcMidnight(from).getTime()) /
      (24 * 60 * 60 * 1000),
  );
}

/** ISO 平日序号：0=周一 … 6=周日（与显示时区无关）。 */
export function isoWeekdayOf(dayKey: string): number {
  const date = utcMidnight(dayKey);
  return (date.getUTCDay() + 6) % 7;
}
