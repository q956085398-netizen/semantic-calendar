/**
 * 月视图网格计算（CAL-001）：纯函数，不接触 DOM 与 React。
 *
 * 约定：
 * - 网格恒为 6 行 × 7 列（42 格），即使当月只需更少行，
 *   保证布局稳定、跨月日期可见；
 * - 周一起始（中文日历惯例）；周起始偏好如将来有真实需求再引入；
 * - 日期一律使用本地时间构造，避免 UTC 偏移让格子漂移到相邻日。
 */

export interface MonthCell {
  /** 本地日期键 YYYY-MM-DD，作为渲染与选择的稳定标识。 */
  dateKey: string;
  year: number;
  /** 1–12。 */
  month: number;
  day: number;
  /** 是否属于当前展示月份（前导 / 后延格为 false）。 */
  inMonth: boolean;
  /** 是否为今天（由调用方注入，避免读取真实时钟）。 */
  isToday: boolean;
}

export interface MonthGrid {
  year: number;
  month: number;
  weeks: MonthCell[][];
}

export interface MonthGridOptions {
  year: number;
  /** 1–12。 */
  month: number;
  /** 今天的日期键；不传则不标记。 */
  today?: string;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 本地日期键，四位年两位月日，供格子身份与 today 匹配使用。 */
export function formatDateKey(
  year: number,
  month: number,
  day: number,
): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 从 Date 提取本地日期键（构造 today 标记用）。 */
export function todayKeyFromDate(date: Date): string {
  return formatDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function buildMonthGrid(options: MonthGridOptions): MonthGrid {
  const { year, month, today } = options;
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`月份必须是 1–12，收到 ${month}`);
  }
  if (today !== undefined && !DATE_KEY_PATTERN.test(today)) {
    throw new RangeError(`today 必须是 YYYY-MM-DD，收到 ${today}`);
  }

  const firstOfMonth = new Date(year, month - 1, 1);
  // Date#getDay: 0=周日 … 6=周六；换算为周一起始的列号。
  const firstColumn = (firstOfMonth.getDay() + 6) % 7;

  const cursor = new Date(year, month - 1, 1 - firstColumn);
  const weeks: MonthCell[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const row: MonthCell[] = [];
    for (let column = 0; column < 7; column += 1) {
      const dateKey = formatDateKey(
        cursor.getFullYear(),
        cursor.getMonth() + 1,
        cursor.getDate(),
      );
      row.push({
        dateKey,
        year: cursor.getFullYear(),
        month: cursor.getMonth() + 1,
        day: cursor.getDate(),
        inMonth:
          cursor.getMonth() + 1 === month && cursor.getFullYear() === year,
        isToday: today !== undefined && dateKey === today,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(row);
  }
  return { year, month, weeks };
}

/** 周表头（周一起始）。 */
export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
