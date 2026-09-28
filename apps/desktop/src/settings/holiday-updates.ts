import {
  HOLIDAY_ARRANGEMENTS,
  type HolidayArrangementData,
} from "../providers/china/holidays-data";
import { createChinaHolidayCalendar } from "../providers/china/holidays";

export type { HolidayArrangementData } from "../providers/china/holidays-data";

export const HOLIDAY_UPDATES_SETTING_KEY = "cn.holidayUpdates";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Parse data before it reaches the existing calendar validator. */
export function parseHolidayArrangement(raw: unknown): HolidayArrangementData {
  if (
    !isRecord(raw) ||
    !Number.isInteger(raw.year) ||
    !Number.isInteger(raw.revision) ||
    typeof raw.notice !== "string" ||
    typeof raw.publishedAt !== "string" ||
    typeof raw.sourceUrl !== "string" ||
    !Array.isArray(raw.items) ||
    raw.items.length === 0 ||
    raw.items.length > 30
  )
    throw new Error("节假日更新文件结构不正确");
  const items = raw.items.map((item) => {
    if (
      !isRecord(item) ||
      !Array.isArray(item.names) ||
      !item.names.every((name) => typeof name === "string") ||
      !Array.isArray(item.rest) ||
      !Array.isArray(item.makeup) ||
      !item.makeup.every((date) => typeof date === "string") ||
      !item.rest.every(
        (range) =>
          isRecord(range) &&
          typeof range.from === "string" &&
          typeof range.to === "string",
      )
    )
      throw new Error("节假日更新文件的日期或假期名称不正确");
    return {
      names: item.names as string[],
      rest: item.rest as { from: string; to: string }[],
      makeup: item.makeup as string[],
    };
  });
  const update: HolidayArrangementData = {
    year: raw.year as number,
    revision: raw.revision as number,
    notice: raw.notice,
    publishedAt: raw.publishedAt,
    sourceUrl: raw.sourceUrl,
    items,
  };
  createChinaHolidayCalendar([update]);
  return update;
}

export function holidayCalendarWithUpdates(
  updates: readonly HolidayArrangementData[],
) {
  const years = new Set(updates.map((update) => update.year));
  return createChinaHolidayCalendar([
    ...HOLIDAY_ARRANGEMENTS.filter(
      (arrangement) => !years.has(arrangement.year),
    ),
    ...updates,
  ]);
}

export function readHolidayUpdates(raw: unknown): HolidayArrangementData[] {
  if (!Array.isArray(raw) || raw.length > 30) return [];
  try {
    const updates = raw.map(parseHolidayArrangement);
    holidayCalendarWithUpdates(updates);
    return updates;
  } catch {
    return [];
  }
}

export function addHolidayUpdate(
  current: readonly HolidayArrangementData[],
  raw: unknown,
): HolidayArrangementData[] {
  const update = parseHolidayArrangement(raw);
  const next = [...current.filter((item) => item.year !== update.year), update];
  holidayCalendarWithUpdates(next);
  return next;
}
