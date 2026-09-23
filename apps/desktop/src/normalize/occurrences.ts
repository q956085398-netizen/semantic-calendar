/**
 * Occurrence 展开（SC-008 / app-spec §7.3 “recurrence 展开 / 解释”）。
 *
 * 读取路径的唯一入口：把存储的原始事件集合转换为某个日期窗口内可见的
 * 具体 occurrence。这一层同时完成时间规范化：
 * - 全天事件保持 YYYY-MM-DD，绝不换算（ICS-002 不漂移）；
 * - TZID 墙钟时间换算为 UTC 瞬时（ICS-003），失败降级为浮动时间（§13）；
 * - 浮动 / UTC 时间保持原样（浮动 = 观察者本地时间的 RFC 语义）；
 * - RRULE 在墙钟空间展开（保持每天几点的语义跨夏令时正确），
 *   每个实例再按 DTSTART 的时区形态转换为可比较 / 可显示的时间。
 */

import type { EnrichedEvent, RawRecurrence } from "../data/model";
import {
  daysBetweenKeys,
  isoWeekdayOf,
  shiftDayKey,
} from "../calendar/date-keys";
import { formatDateKey, todayKeyFromDate } from "../calendar/month-grid";
import { parseIcsCompactDate } from "./ics-dates";
import { parseRrule, type ParsedRrule } from "./rrule";
import { wallClockToUtcIso } from "./timezone";

/** 可见窗口 [from, to]，闭区间，日期键 YYYY-MM-DD。 */
export interface OccurrenceWindow {
  from: string;
  to: string;
}

/**
 * 防御性上限：病态规则（久远 DTSTART 的无界 DAILY 等）最多生成这么多
 * 候选实例就停，宁可少展示也不让 UI 卡死（app-spec §13 / §15）。
 */
const MAX_CANDIDATES = 100_000;

export function expandEventOccurrences(
  events: EnrichedEvent[],
  window: OccurrenceWindow,
): EnrichedEvent[] {
  // RECURRENCE-ID 例外按 (sourceId, uid) 归组，交给对应 master 消费。
  const exceptionsByMaster = new Map<string, EnrichedEvent[]>();
  for (const event of events) {
    if (event.occurrenceId !== undefined) {
      const key = `${event.sourceId}\u0000${event.uid}`;
      const bucket = exceptionsByMaster.get(key);
      if (bucket) {
        bucket.push(event);
      } else {
        exceptionsByMaster.set(key, [event]);
      }
    }
  }

  const occurrences: EnrichedEvent[] = [];
  const handledExceptions = new Set<EnrichedEvent>();
  for (const event of events) {
    if (event.occurrenceId !== undefined) {
      continue;
    }
    const exceptions =
      exceptionsByMaster.get(`${event.sourceId}\u0000${event.uid}`) ?? [];
    occurrences.push(
      ...expandMaster(event, exceptions, window, handledExceptions),
    );
  }
  // 无对应 master 的孤儿例外（master 被停用 / 不在输入中）按自身时间展示。
  for (const event of events) {
    if (event.occurrenceId === undefined || handledExceptions.has(event)) {
      continue;
    }
    if (event.cancelled) {
      continue;
    }
    const occurrence = canonicalizeTimezones(event);
    if (overlapsWindow(occurrence, window)) {
      occurrences.push(occurrence);
    }
  }
  return occurrences;
}

/** 单个 master（无 occurrenceId 的事件）→ 窗口内 occurrence 列表。 */
function expandMaster(
  master: EnrichedEvent,
  exceptions: EnrichedEvent[],
  window: OccurrenceWindow,
  handledExceptions: Set<EnrichedEvent>,
): EnrichedEvent[] {
  const ruleText = master.recurrence?.rrule;
  if (ruleText === undefined) {
    const occurrence = canonicalizeTimezones(master);
    return overlapsWindow(occurrence, window) ? [occurrence] : [];
  }
  const rule = parseRrule(ruleText);
  if (rule === undefined) {
    // 无法安全解释的规则降级为单次事件（P-01：宁可不展开也不错展开）。
    const occurrence = canonicalizeTimezones(master);
    return overlapsWindow(occurrence, window) ? [occurrence] : [];
  }

  const occurrences: EnrichedEvent[] = [];
  for (const candidate of candidatesOf(master, rule, window)) {
    if (excludedByExdate(master, candidate)) {
      continue;
    }
    const exception = exceptions.find((candidateException) =>
      exceptionMatches(candidateException, master, candidate),
    );
    if (exception !== undefined) {
      handledExceptions.add(exception);
      // 例外替换生成实例（同一 occurrence 不重复）；取消则直接消失。
      if (!exception.cancelled) {
        const occurrence = canonicalizeTimezones(exception);
        if (overlapsWindow(occurrence, window)) {
          occurrences.push(occurrence);
        }
      }
      continue;
    }
    const occurrence = occurrenceOf(master, candidate);
    if (overlapsWindow(occurrence, window)) {
      occurrences.push(occurrence);
    }
  }
  // 指向候选流之外实例的例外（原实例越过窗口 / COUNT / UNTIL 等）
  // 无法在生成流中被替换，按自身时间展示，保证改期不丢失。
  for (const exception of exceptions) {
    if (handledExceptions.has(exception) || exception.cancelled) {
      continue;
    }
    const occurrence = canonicalizeTimezones(exception);
    if (overlapsWindow(occurrence, window)) {
      occurrences.push(occurrence);
    }
  }
  return occurrences;
}

/** 生成的具体实例：master 墙钟空间 → 展示 / 存储身份形态。 */
interface OccurrenceCandidate {
  /** 墙钟（或 Z 形态）ISO：与 master.start 同一比较空间。 */
  identity: string;
  /** 展示用开始时间：TZID 事件换算为 UTC 瞬时，其余与 identity 相同。 */
  start: string;
  /** 展示用结束时间；无结束时间为 undefined。 */
  end?: string;
  /** 全天事件的日期键形态（identity 即日期）。 */
  allDay: boolean;
}

/** 候选实例流（已按 COUNT / UNTIL / 窗口上界 / 迭代上限截断）。 */
function* candidatesOf(
  master: EnrichedEvent,
  rule: ParsedRrule,
  window: OccurrenceWindow,
): Generator<OccurrenceCandidate> {
  const frame = timeFrameOf(master);
  let produced = 0;
  for (const wallIso of wallCandidates(master, rule, window.to)) {
    if (rule.until !== undefined && !withinUntil(master, wallIso, rule.until)) {
      return;
    }
    if (rule.count !== undefined && produced >= rule.count) {
      return;
    }
    produced += 1;
    yield materializeCandidate(master, wallIso, frame);
  }
}

/**
 * 墙钟空间候选流：从 DTSTART 起按 FREQ 生成，保证时间顺序。
 * 全天与 Z 形态事件同样适用（Z 形态按 RFC 为固定 UTC 瞬时，步进即 UTC 算术）。
 * 周起始固定为周一（WKST=MO 默认值，解析层已拒绝其他值）。
 */
function* wallCandidates(
  master: EnrichedEvent,
  rule: ParsedRrule,
  windowTo: string,
): Generator<string> {
  const start = master.start;
  const day = start.slice(0, 10);
  const time = start.slice(10); // "THH:MM:SS…"（全天为空）
  let produced = 0;

  /** 候选日 → 完整墙钟值；越界（窗口外 / 早于 DTSTART）返回 undefined。 */
  const candidateOf = (candidateDay: string): string | undefined => {
    if (candidateDay > windowTo) {
      return undefined;
    }
    const candidate = candidateDay + time;
    // DTSTART 之前的候选不生成（RFC：DTSTART 是首个实例的锚点）。
    return candidate < start ? undefined : candidate;
  };

  if (rule.freq === "DAILY") {
    // RFC：DAILY 的 BYDAY 是过滤器（限定平日集合），不是生成器。
    const weekdayFilter =
      rule.byDay === undefined
        ? undefined
        : new Set(rule.byDay.map((entry) => entry.weekday));
    for (let offset = 0; ; offset += rule.interval) {
      if (produced >= MAX_CANDIDATES) {
        return;
      }
      const candidateDay = shiftDayKey(day, offset);
      if (candidateDay > windowTo) {
        return;
      }
      if (
        weekdayFilter !== undefined &&
        !weekdayFilter.has(isoWeekdayOf(candidateDay))
      ) {
        continue;
      }
      const candidate = candidateOf(candidateDay);
      if (candidate !== undefined) {
        produced += 1;
        yield candidate;
      }
    }
  }

  if (rule.freq === "WEEKLY") {
    // 0=周一 … 6=周日；默认重复 DTSTART 的平日。
    const weekdays = [
      ...new Set(
        (rule.byDay?.map((entry) => entry.weekday) ?? [isoWeekdayOf(day)]).sort(
          (a, b) => a - b,
        ),
      ),
    ];
    const anchorMonday = shiftDayKey(day, -isoWeekdayOf(day));
    for (let week = 0; ; week += 1) {
      if (produced >= MAX_CANDIDATES) {
        return;
      }
      const weekStart = shiftDayKey(anchorMonday, week * rule.interval * 7);
      if (weekStart > windowTo) {
        return;
      }
      for (const weekday of weekdays) {
        const candidate = candidateOf(shiftDayKey(weekStart, weekday));
        if (candidate !== undefined) {
          produced += 1;
          yield candidate;
        }
      }
    }
  }

  if (rule.freq === "MONTHLY") {
    const startYear = Number(day.slice(0, 4));
    const startMonth = Number(day.slice(5, 7));
    const startDayNum = Number(day.slice(8, 10));
    const baseMonthIndex = startYear * 12 + (startMonth - 1);
    for (let step = 0; ; step += 1) {
      if (produced >= MAX_CANDIDATES) {
        return;
      }
      const monthIndex = baseMonthIndex + step * rule.interval;
      const year = Math.floor(monthIndex / 12);
      const month = monthIndex - year * 12 + 1;
      if (formatDateKey(year, month, 1) > windowTo) {
        return;
      }
      for (const candidateDay of monthDays(rule, year, month, startDayNum)) {
        const candidate = candidateOf(candidateDay);
        if (candidate !== undefined) {
          produced += 1;
          yield candidate;
        }
      }
    }
  }

  // FREQ=YEARLY：默认重复 DTSTART 的月 / 日；不存在的日子（2 月 29 日）跳过。
  // （YEARLY + BYDAY / BYMONTHDAY 的语义在解析层被拒绝，不会到达这里。）
  const startYear = Number(day.slice(0, 4));
  const startMonth = Number(day.slice(5, 7));
  const startDayNum = Number(day.slice(8, 10));
  for (let step = 0; ; step += 1) {
    if (produced >= MAX_CANDIDATES) {
      return;
    }
    const year = startYear + step * rule.interval;
    if (formatDateKey(year, startMonth, 1) > windowTo) {
      return;
    }
    if (dayExists(year, startMonth, startDayNum)) {
      const candidate = candidateOf(
        formatDateKey(year, startMonth, startDayNum),
      );
      if (candidate !== undefined) {
        produced += 1;
        yield candidate;
      }
    }
  }
}

/** master 的时间形态决定生成实例的身份与展示格式。 */
function timeFrameOf(master: EnrichedEvent): "date" | "utc" | "wall" | "tzid" {
  if (master.allDay) {
    return "date";
  }
  if (master.startTzid !== undefined) {
    return "tzid";
  }
  return master.start.endsWith("Z") ? "utc" : "wall";
}

/** 候选墙钟 → 具体实例（身份保持 master 形态，TZID 展示为 UTC 瞬时）。 */
function materializeCandidate(
  master: EnrichedEvent,
  wallIso: string,
  frame: "date" | "utc" | "wall" | "tzid",
): OccurrenceCandidate {
  if (frame === "date") {
    const startDay = wallIso.slice(0, 10);
    const spanDays = master.end
      ? daysBetweenKeys(master.start.slice(0, 10), master.end.slice(0, 10))
      : 0;
    return {
      identity: startDay,
      start: startDay,
      ...(spanDays > 0 && { end: shiftDayKey(startDay, spanDays) }),
      allDay: true,
    };
  }

  const durationMs = master.end
    ? utcComponentMs(master.end) - utcComponentMs(master.start)
    : undefined;
  const endWall =
    durationMs !== undefined
      ? isoFromUtcComponentMs(utcComponentMs(wallIso) + durationMs, frame)
      : undefined;

  if (frame === "tzid") {
    return {
      identity: wallIso,
      start: tryWallClockToUtcIso(wallIso, master.startTzid) ?? wallIso,
      ...(endWall !== undefined && {
        end:
          tryWallClockToUtcIso(endWall, master.endTzid ?? master.startTzid) ??
          endWall,
      }),
      allDay: false,
    };
  }
  return {
    identity: wallIso,
    start: wallIso,
    ...(endWall !== undefined && { end: endWall }),
    allDay: false,
  };
}

function occurrenceOf(
  master: EnrichedEvent,
  candidate: OccurrenceCandidate,
): EnrichedEvent {
  return {
    ...master,
    start: candidate.start,
    ...(candidate.end !== undefined && { end: candidate.end }),
    occurrenceId: candidate.identity,
  };
}

/** UNTIL 含边界：候选 == UNTIL 仍算最后一个实例。 */
function withinUntil(
  master: EnrichedEvent,
  wallIso: string,
  until: { value: string; utc: boolean },
): boolean {
  if (master.allDay) {
    return wallIso.slice(0, 10) <= until.value.slice(0, 10);
  }
  if (until.utc || master.start.endsWith("Z")) {
    const untilMs = until.utc
      ? Date.parse(until.value)
      : tryWallClockToUtcMs(until.value, master.startTzid);
    const candidateMs = utcMsInMasterFrame(master, wallIso);
    if (untilMs !== undefined && candidateMs !== undefined) {
      return candidateMs <= untilMs;
    }
  }
  return wallIso <= until.value;
}

/** master 形态下的候选 → UTC 瞬时毫秒；无法换算为 undefined。 */
function utcMsInMasterFrame(
  master: EnrichedEvent,
  wallIso: string,
): number | undefined {
  if (wallIso.endsWith("Z")) {
    return Date.parse(wallIso);
  }
  return tryWallClockToUtcMs(wallIso, master.startTzid);
}

/** 墙钟 ISO → UTC 瞬时毫秒；无时区信息或非法时区名返回 undefined。 */
function tryWallClockToUtcMs(
  wallIso: string,
  tzid: string | undefined,
): number | undefined {
  if (wallIso.endsWith("Z")) {
    return Date.parse(wallIso);
  }
  if (tzid === undefined) {
    return undefined;
  }
  const converted = tryWallClockToUtcIso(wallIso, tzid);
  return converted === undefined ? undefined : Date.parse(converted);
}

function tryWallClockToUtcIso(
  wallIso: string,
  tzid: string | undefined,
): string | undefined {
  if (tzid === undefined) {
    return undefined;
  }
  try {
    return wallClockToUtcIso(wallIso, tzid);
  } catch {
    return undefined;
  }
}

/** EXDATE 是否命中候选实例（ICS-004）。 */
function excludedByExdate(
  master: EnrichedEvent,
  candidate: OccurrenceCandidate,
): boolean {
  const exdates: RawRecurrence["exdates"] = master.recurrence?.exdates ?? [];
  if (exdates.length === 0) {
    return false;
  }
  if (master.allDay) {
    const candidateDay = candidate.identity.slice(0, 10);
    return exdates.some((exdate) => {
      const parsed = parseIcsCompactDate(exdate.value);
      return parsed !== undefined && parsed.date === candidateDay;
    });
  }
  const candidateUtc = utcMsInMasterFrame(master, candidate.identity);
  return exdates.some((exdate) => {
    const parsed = parseIcsCompactDate(exdate.value);
    if (parsed === undefined) {
      return false;
    }
    // 日期形态对时间事件按“排除当天实例”宽容处理（部分生产者这么发）。
    if (parsed.iso.length === 10) {
      return parsed.date === candidate.identity.slice(0, 10);
    }
    // 同帧墙钟直接比较；跨帧 / 跨时区（EXDATE 自带 TZID）在 UTC 瞬时比较。
    if (parsed.iso === candidate.identity) {
      return true;
    }
    const exdateUtc = parsed.utc
      ? Date.parse(parsed.iso)
      : tryWallClockToUtcMs(parsed.iso, exdate.tzid ?? master.startTzid);
    return (
      exdateUtc !== undefined &&
      candidateUtc !== undefined &&
      exdateUtc === candidateUtc
    );
  });
}

/** 例外（RECURRENCE-ID）是否指向该候选实例。 */
function exceptionMatches(
  exception: EnrichedEvent,
  master: EnrichedEvent,
  candidate: OccurrenceCandidate,
): boolean {
  const target = exception.occurrenceId;
  if (target === undefined) {
    return false;
  }
  if (target === candidate.identity) {
    return true;
  }
  // 跨形态兜底：两侧都能换算成 UTC 瞬时且相等（如 Z 形态例外对墙钟 master）。
  // 例外与 master 属同一系列，非 Z 形态按 master 的时区解释（RFC 常见产出）。
  const targetUtc = tryWallClockToUtcMs(target, master.startTzid);
  const candidateUtc = utcMsInMasterFrame(master, candidate.identity);
  return (
    targetUtc !== undefined &&
    candidateUtc !== undefined &&
    targetUtc === candidateUtc
  );
}

/**
 * TZID 墙钟时间 → UTC 瞬时；无法换算（非法时区名等）时保持原值，
 * 事件以浮动语义继续可见（app-spec §13 降级）。
 */
function canonicalizeTimezones(event: EnrichedEvent): EnrichedEvent {
  if (event.allDay || event.startTzid === undefined) {
    return event;
  }
  try {
    const start = wallClockToUtcIso(event.start, event.startTzid);
    const end =
      event.end === undefined
        ? undefined
        : wallClockToUtcIso(event.end, event.endTzid ?? event.startTzid);
    return { ...event, start, ...(end !== undefined && { end }) };
  } catch {
    return event;
  }
}

/** 事件区间（含结束日）是否与窗口相交。 */
function overlapsWindow(
  event: EnrichedEvent,
  window: OccurrenceWindow,
): boolean {
  if (event.allDay) {
    const startDay = event.start.slice(0, 10);
    const endDay = event.end
      ? shiftDayKey(event.end.slice(0, 10), -1)
      : startDay;
    return startDay <= window.to && endDay >= window.from;
  }
  const startDay = localDayKey(event.start);
  if (startDay > window.to) {
    return false;
  }
  if (!event.end) {
    return startDay >= window.from;
  }
  const endDay = inclusiveEndDay(localDayKey(event.end), event.end, startDay);
  return endDay >= window.from;
}

/** 时间事件的本地日期键；UTC 瞬时按观察者本地时区落日。 */
function localDayKey(iso: string): string {
  if (iso.endsWith("Z")) {
    return todayKeyFromDate(new Date(iso));
  }
  return iso.slice(0, 10);
}

/** 结束恰为当地 00:00 视为独占边界，回落到前一天（与 event-buckets 一致）。 */
function inclusiveEndDay(
  endDay: string,
  endIso: string,
  startDay: string,
): string {
  const timePart = endIso.endsWith("Z")
    ? new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(endIso))
    : endIso.slice(11, 16);
  if (timePart === "00:00" && endDay > startDay) {
    return shiftDayKey(endDay, -1);
  }
  return endDay;
}

function daysInMonthOf(year: number, month: number): number {
  // 月分量为 0 表示“上一个月的最后一天”，即当月天数。
  const probe = new Date(0);
  probe.setUTCFullYear(year, month, 0);
  return probe.getUTCDate();
}

function dayExists(year: number, month: number, day: number): boolean {
  return day >= 1 && day <= daysInMonthOf(year, month);
}

/**
 * MONTHLY 的候选日集合（升序去重）。同时给出 BYMONTHDAY 与 BYDAY 时
 * 取交集（RFC 5545 语义）；仅其一或都缺省时按对应规则生成。
 * 不存在的日子跳过。
 */
function monthDays(
  rule: ParsedRrule,
  year: number,
  month: number,
  startDayNum: number,
): string[] {
  const daysInMonth = daysInMonthOf(year, month);

  const monthDaySet = new Set<number>();
  for (const monthDay of rule.byMonthDay ?? []) {
    const day = monthDay > 0 ? monthDay : daysInMonth + monthDay + 1;
    if (day >= 1 && day <= daysInMonth) {
      monthDaySet.add(day);
    }
  }

  const weekdaySet = new Set<number>();
  for (const entry of rule.byDay ?? []) {
    if (entry.ordinal !== undefined) {
      const day = nthWeekdayOfMonth(year, month, entry.weekday, entry.ordinal);
      if (day !== undefined) {
        weekdaySet.add(day);
      }
    } else {
      for (let day = 1; day <= daysInMonth; day += 1) {
        if (isoWeekdayOf(formatDateKey(year, month, day)) === entry.weekday) {
          weekdaySet.add(day);
        }
      }
    }
  }

  let days: Iterable<number>;
  if (rule.byMonthDay !== undefined && rule.byDay !== undefined) {
    days = [...monthDaySet].filter((day) => weekdaySet.has(day));
  } else if (rule.byMonthDay !== undefined) {
    days = monthDaySet;
  } else if (rule.byDay !== undefined) {
    days = weekdaySet;
  } else {
    days = startDayNum <= daysInMonth ? [startDayNum] : [];
  }

  return [...days]
    .sort((a, b) => a - b)
    .map((day) => formatDateKey(year, month, day));
}

/** 第 N 个（正）或倒数第 N 个（负）指定平日；不存在返回 undefined。 */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  ordinal: number,
): number | undefined {
  const daysInMonth = daysInMonthOf(year, month);
  const firstDow = isoWeekdayOf(formatDateKey(year, month, 1));
  const firstMatch = 1 + ((weekday - firstDow + 7) % 7);
  if (ordinal > 0) {
    const day = firstMatch + (ordinal - 1) * 7;
    return day <= daysInMonth ? day : undefined;
  }
  const lastDow = isoWeekdayOf(formatDateKey(year, month, daysInMonth));
  const lastMatch = daysInMonth - ((lastDow - weekday + 7) % 7);
  const day = lastMatch + (ordinal + 1) * 7;
  return day >= 1 ? day : undefined;
}

/**
 * ISO → UTC 分量毫秒：把墙钟分量当作 UTC 做纯算术（跨天 / 时长推算），
 * 不代表任何真实瞬时，也不经过时区换算。
 */
function utcComponentMs(iso: string): number {
  return Date.parse(`${iso.slice(0, 19)}Z`) || 0;
}

/** UTC 分量毫秒 → master 形态 ISO（Z 形态补 .000Z）。 */
function isoFromUtcComponentMs(
  ms: number,
  frame: "utc" | "wall" | "tzid",
): string {
  const iso = new Date(ms).toISOString().slice(0, 19);
  return frame === "utc" ? `${iso}.000Z` : iso;
}
