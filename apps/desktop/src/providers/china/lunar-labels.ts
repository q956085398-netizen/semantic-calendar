import type { LunarDate } from "./lunar";

/**
 * 农历文本（SC-010 / CN-001）。
 *
 * 与换算（lunar.ts）分开：算出来的农历年月日是什么，和它在界面上怎么写，
 * 是两个问题——换成「冬月 / 腊月」这类传统别名、或增加干支生肖，
 * 都只动这一层。
 *
 * 月格口径（ui-design §5.2「公历日数字 + 农历简写」）：
 * - 初一是农历的月份边界，因此写月名（「八月」「闰四月」），
 *   而不是「初一」——一行里能看到月份边界，闰月也不会退化成普通月份；
 * - 其余日期写农历日名（「初二」…「三十」），保持一格一行、不挤压日期数字。
 * 详情栏写完整写法（「农历八月廿七」），与 ui-design §9.2 的示例一致。
 */

const MONTH_NAMES = [
  "正月",
  "二月",
  "三月",
  "四月",
  "五月",
  "六月",
  "七月",
  "八月",
  "九月",
  "十月",
  "十一月",
  "十二月",
];

const DAY_NAMES = [
  "初一",
  "初二",
  "初三",
  "初四",
  "初五",
  "初六",
  "初七",
  "初八",
  "初九",
  "初十",
  "十一",
  "十二",
  "十三",
  "十四",
  "十五",
  "十六",
  "十七",
  "十八",
  "十九",
  "二十",
  "廿一",
  "廿二",
  "廿三",
  "廿四",
  "廿五",
  "廿六",
  "廿七",
  "廿八",
  "廿九",
  "三十",
];

/** 农历日名：初一…三十。 */
export function lunarDayLabel(day: number): string {
  if (!Number.isInteger(day) || day < 1 || day > 30) {
    throw new RangeError(`农历日必须是 1–30，收到 ${day}`);
  }
  return DAY_NAMES[day - 1];
}

/** 农历月名：正月…十二月；闰月前缀「闰」。 */
export function lunarMonthLabel(month: number, isLeapMonth = false): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`农历月份必须是 1–12，收到 ${month}`);
  }
  return `${isLeapMonth ? "闰" : ""}${MONTH_NAMES[month - 1]}`;
}

/** 月格简写：初一写月名（月份边界），其余写日名。 */
export function lunarCellText(lunar: LunarDate): string {
  return lunar.day === 1
    ? lunarMonthLabel(lunar.month, lunar.isLeapMonth)
    : lunarDayLabel(lunar.day);
}

/** 详情栏完整写法：农历八月廿七 / 农历闰六月初一。 */
export function lunarDetailText(lunar: LunarDate): string {
  return `农历${lunarMonthLabel(lunar.month, lunar.isLeapMonth)}${lunarDayLabel(lunar.day)}`;
}
