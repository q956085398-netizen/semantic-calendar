/**
 * 入库标准化（SC-008 / app-spec §7.3 + §11）。
 *
 * 原始事件原样保留，只附加可由原始字段重建的标准化结果：
 * - normalizedTitle：Unicode / 空白清洗后的标题（Matcher 的输入）；
 * - timezone：事件时区语义（IANA 名 / UTC；浮动与全天缺省）。
 * TZID → UTC 的瞬时换算不落库：occurrence 展开在读取路径计算
 * （SEM-004：规则更新后无需重新导入即可修正结果）。
 * 标准化字段总是从原始字段重算，重复执行幂等。
 */

import type { RawCalendarEvent, StoredEvent } from "../data/model";
import { normalizeEventTitle } from "./title";

export function normalizeEventForStorage(event: RawCalendarEvent): StoredEvent {
  const timezone = resolveTimezone(event);
  return {
    ...event,
    normalizedTitle: normalizeEventTitle(event.title),
    ...(timezone !== undefined && { timezone }),
  };
}

/** 时区语义：TZID > UTC > 浮动（缺省）；全天事件无时区语义。 */
function resolveTimezone(event: RawCalendarEvent): string | undefined {
  if (event.allDay) {
    return undefined;
  }
  if (event.startTzid !== undefined) {
    return event.startTzid;
  }
  return event.start.endsWith("Z") ? "UTC" : undefined;
}
