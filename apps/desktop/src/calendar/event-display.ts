import type { EnrichedEvent } from "../data/model";

/**
 * 事件的时间前缀（月格摘要 / Inspector 共用）。
 * 全天事件返回空串（不显示时间）；UTC 事件换算为本地 HH:mm，
 * 浮动本地时间直接取存储的日期部分。
 */
export function eventTimeLabel(
  event: Pick<EnrichedEvent, "start" | "allDay">,
): string {
  if (event.allDay) {
    return "";
  }
  if (event.start.endsWith("Z")) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(event.start));
  }
  return event.start.slice(11, 16);
}
