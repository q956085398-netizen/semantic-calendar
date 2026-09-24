import type { ChinaDayKind, ChinaHolidayDay } from "./holidays";

/**
 * 法定节假日的文本（SC-011 / CN-002–004）。
 *
 * 与查询（holidays.ts）分开：哪一天放假是事实，放假在界面上怎么写是另一件事——
 * 改大字用字、改假期名的连接方式、加英文名，都只动这一层。
 *
 * 口径按 ui-design：
 * - 大字（§7.2 / §8.2）只写一个字：「休」表示放假，「补」表示补班；
 * - 假期名按通知原文列出（§7「国庆节、中秋节」），合并放假的条目不止一段；
 * - 连休位置（§7.1 连续视觉）写成「第 2 天 / 共 9 天」，单日假期不写位置。
 */

/** 放假大字（ui-design §7.2）。 */
export const REST_GLYPH = "休";

/** 补班大字（ui-design §8.2），与休假同一种视觉语言、颜色区分（§20）。 */
export const MAKEUP_GLYPH = "补";

/** 假期名：合并放假的条目写成「国庆节、中秋节」。 */
export function holidayNamesText(names: readonly string[]): string {
  if (names.length === 0) {
    throw new Error("假期名不能为空");
  }
  return names.join("、");
}

/** 语义大字：休 / 补。 */
export function chinaDayGlyph(kind: ChinaDayKind): string {
  return kind === "rest" ? REST_GLYPH : MAKEUP_GLYPH;
}

/** 详情栏主文案：「春节假期」「国庆节、中秋节假期」「国庆节补班日」。 */
export function chinaDayLabelText(day: ChinaHolidayDay): string {
  const name = holidayNamesText(day.names);
  return day.kind === "rest" ? `${name}假期` : `${name}补班日`;
}

/**
 * 连休位置文案：「第 2 天 / 共 9 天」。
 * 只放一天假的假期（2025 年元旦是唯一一例）没有连休位置可讲，
 * 补班日也不属于连休，两者都返回 undefined，不写多余的话。
 */
export function chinaDayPositionText(day: ChinaHolidayDay): string | undefined {
  if (day.kind !== "rest" || day.run.length < 2) {
    return undefined;
  }
  return `第 ${day.run.index + 1} 天 / 共 ${day.run.length} 天`;
}
