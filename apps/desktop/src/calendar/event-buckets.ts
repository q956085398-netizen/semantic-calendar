import type { EnrichedEvent } from "../data/model";
import { todayKeyFromDate } from "./month-grid";
import { daysBetweenKeys, shiftDayKey } from "./date-keys";

/**
 * 事件 → 日期键分桶（SC-006：导入后月视图可见）。
 *
 * 规则：
 * - 全天事件从开始日铺到结束日前一天（RFC 5545 的 DTEND 独占语义），
 *   日期字符串直接使用，不做任何时区换算（ICS-002 不漂移）；
 * - 浮动本地时间取日期部分；UTC 时间换算为本地日期
 *   （比赛在当地几点开始就落在用户当地哪一天）；
 * - 跨天时间事件（如 19:00 出发、次日 02:00 到达）覆盖开始日至结束日，
 *   结束恰为当地 00:00 时视为独占边界、不算那一天；
 * - 跨度截断到 370 天，防止病态数据（坏 DTEND）拖垮月视图渲染。
 */

/** 与存储的三种时间形态都无关，只取“哪一天”所需的最小字段。 */
type DateKeySource = Pick<EnrichedEvent, "start" | "end" | "allDay">;

const MAX_SPAN_DAYS = 370;

/** 事件覆盖的本地日期键（YYYY-MM-DD），按时间顺序返回。 */
export function eventDateKeys(event: DateKeySource): string[] {
  if (!event.allDay) {
    const startDay = dateKeyOfDateTime(event.start);
    if (!event.end) {
      return [startDay];
    }
    return spanKeys(startDay, inclusiveEndDay(event.end, startDay));
  }

  const startDay = event.start.slice(0, 10);
  if (!event.end) {
    return [startDay];
  }
  return spanKeys(startDay, shiftDayKey(event.end.slice(0, 10), -1));
}

/** 时间事件的结束日：恰为当地 00:00 时回退一天（独占边界）。 */
function inclusiveEndDay(endIso: string, startDay: string): string {
  const endDay = dateKeyOfDateTime(endIso);
  const timePart = endIso.endsWith("Z")
    ? new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(endIso))
    : endIso.slice(11, 16);
  if (timePart === "00:00" && daysBetweenKeys(startDay, endDay) > 0) {
    return shiftDayKey(endDay, -1);
  }
  return endDay;
}

/** 从 startDay 铺到 endDay（含），非法 / 超长跨度按容错与上限处理。 */
function spanKeys(startDay: string, endDay: string): string[] {
  const spanDays = Math.min(
    Math.max(daysBetweenKeys(startDay, endDay), 0) + 1,
    MAX_SPAN_DAYS,
  );
  const keys: string[] = [];
  for (let offset = 0; offset < spanDays; offset += 1) {
    keys.push(shiftDayKey(startDay, offset));
  }
  return keys;
}

/** 事件按日期键分桶；同一天内全天在前，再按开始时间、uid 稳定排序。 */
export function bucketEventsByDateKey(
  events: EnrichedEvent[],
): Map<string, EnrichedEvent[]> {
  const buckets = new Map<string, EnrichedEvent[]>();
  for (const event of events) {
    for (const key of eventDateKeys(event)) {
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(event);
      } else {
        buckets.set(key, [event]);
      }
    }
  }
  for (const bucket of buckets.values()) {
    bucket.sort(
      (a, b) => compareString(a.start, b.start) || compareString(a.uid, b.uid),
    );
  }
  return buckets;
}

function dateKeyOfDateTime(iso: string): string {
  if (iso.endsWith("Z")) {
    return todayKeyFromDate(new Date(iso));
  }
  return iso.slice(0, 10);
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
