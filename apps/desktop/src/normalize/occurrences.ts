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
import { localTimeOfDayLabel } from "../format/time";
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
  const steps = expandEventOccurrencesInChunks(events, window, NO_SLICES);
  let step = steps.next();
  while (!step.done) {
    step = steps.next();
  }
  return step.value;
}

/** 分片粒度（chunkEvents）为 0：中间不让出，一次跑完（同步入口）。 */
const NO_SLICES = 0;

/**
 * 分片展开（SC-020 / app-spec §15「大量事件不应阻塞 UI 线程」）。
 *
 * 输出与 expandEventOccurrences 逐条相同，只是每处理 chunkEvents 条事件让出
 * 一次控制权：调用方在 yield 处决定怎么让（读取路径见 calendar/month-occurrences
 * ——按时间预算让出主线程，界面才能重绘、点击才有响应）。同步入口就是这个
 * 生成器的一次排空，因此两条路径不可能各自演化出不同的语义。
 *
 * 三趟扫描的先后不能交换：第二趟要用第一趟汇总的例外表，第三趟要用第二趟
 * 记下的 handledExceptions（哪些例外已被对应 master 消费）。
 */
export function* expandEventOccurrencesInChunks(
  events: readonly EnrichedEvent[],
  window: OccurrenceWindow,
  chunkEvents: number,
): Generator<void, EnrichedEvent[], void> {
  // 第一趟：RECURRENCE-ID 例外按 (sourceId, uid) 归组，交给对应 master 消费。
  const exceptionsByMaster = new Map<string, EnrichedEvent[]>();
  yield* forEachInChunks(events, chunkEvents, (event) => {
    if (event.occurrenceId === undefined) {
      return;
    }
    const key = `${event.sourceId}\u0000${event.uid}`;
    const bucket = exceptionsByMaster.get(key);
    if (bucket) {
      bucket.push(event);
    } else {
      exceptionsByMaster.set(key, [event]);
    }
  });

  // 第二趟：master 展开。
  const occurrences: EnrichedEvent[] = [];
  const handledExceptions = new Set<EnrichedEvent>();
  yield* forEachInChunks(events, chunkEvents, (event) => {
    if (event.occurrenceId !== undefined) {
      return;
    }
    const exceptions =
      exceptionsByMaster.get(`${event.sourceId}\u0000${event.uid}`) ?? [];
    occurrences.push(
      ...expandMaster(event, exceptions, window, handledExceptions),
    );
  });

  // 第三趟：无对应 master 的孤儿例外（master 被停用 / 不在输入中）按自身时间展示。
  yield* forEachInChunks(events, chunkEvents, (event) => {
    if (event.occurrenceId === undefined || handledExceptions.has(event)) {
      return;
    }
    if (event.cancelled) {
      return;
    }
    const occurrence = canonicalizeTimezones(event);
    if (overlapsWindow(occurrence, window)) {
      occurrences.push(occurrence);
    }
  });

  return occurrences;
}

/**
 * 按条数分片遍历：每 chunkEvents 条让出一次，每趟结束再让出一次（调用方
 * 因此也能在趟与趟之间重绘）。chunkEvents <= 0 表示中间不让出。
 */
function* forEachInChunks<T>(
  items: readonly T[],
  chunkEvents: number,
  visit: (item: T) => void,
): Generator<void, void, void> {
  let index = 0;
  for (const item of items) {
    visit(item);
    index += 1;
    if (chunkEvents > 0 && index % chunkEvents === 0 && index < items.length) {
      yield;
    }
  }
  if (chunkEvents > 0) {
    yield;
  }
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
    return singleOccurrence(master, window);
  }
  const rule = parseRrule(ruleText);
  if (rule === undefined) {
    // 无法安全解释的规则降级为单次事件（P-01：宁可不展开也不错展开）。
    return singleOccurrence(master, window);
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

/**
 * 单次事件 → 窗口内 occurrence（0 或 1 条）。
 * 先做日期级预筛再换算时区：窗口只覆盖 42 天，而一次月切换要过一遍全部事件，
 * 为必然不可见的事件做墙钟 → UTC 换算（每条约 11µs）是纯浪费。
 */
function singleOccurrence(
  event: EnrichedEvent,
  window: OccurrenceWindow,
): EnrichedEvent[] {
  if (!couldOverlapWindow(event, window)) {
    return [];
  }
  const occurrence = canonicalizeTimezones(event);
  return overlapsWindow(occurrence, window) ? [occurrence] : [];
}

/**
 * 便宜的窗口预筛（日期级，两侧各留一天余量）：只用来跳过必然不可见的
 * 事件，判定为“可能可见”的仍走原有的精确逻辑。墙钟 / UTC 形态的同一天
 * 在不同时区可能前后偏一天，多日事件的跨度也必须计入，所以余量不能省。
 */
function couldOverlapWindow(
  event: EnrichedEvent,
  window: OccurrenceWindow,
): boolean {
  const startDay = event.start.slice(0, 10);
  const spanDays = spanDaysOf(event);
  return (
    shiftDayKey(startDay, spanDays + 1) >= window.from &&
    shiftDayKey(startDay, -1) <= window.to
  );
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
  const spanDays = spanDaysOf(master);
  let produced = 0;
  for (const wallIso of wallCandidates(master, rule, window.to)) {
    if (rule.until !== undefined && !withinUntil(master, wallIso, rule.until)) {
      return;
    }
    if (rule.count !== undefined && produced >= rule.count) {
      return;
    }
    produced += 1;
    // 窗口之前的候选只计数、不物化：COUNT / UNTIL 的语义完全不变，
    // 省下的是每条候选的时区换算与 EXDATE / 例外匹配。长序列（例如从
    // 1 月起的每周事件在 11 月的窗口里）有九成候选落在窗口之前。
    if (beforeWindow(wallIso, spanDays, window.from)) {
      continue;
    }
    yield materializeCandidate(master, wallIso, frame);
  }
}

/**
 * 事件自身跨度（天，向上取整），用于判断候选是否可能落进窗口。
 * 多日事件开始于窗口之前仍可能与窗口相交，因此这个跨度必须计入。
 */
function spanDaysOf(master: EnrichedEvent): number {
  if (master.end === undefined) {
    return 0;
  }
  if (master.allDay) {
    return Math.max(
      0,
      daysBetweenKeys(master.start.slice(0, 10), master.end.slice(0, 10)),
    );
  }
  const durationMs = utcComponentMs(master.end) - utcComponentMs(master.start);
  return durationMs <= 0 ? 0 : Math.ceil(durationMs / 86_400_000);
}

/**
 * 候选是否确定落在窗口之前：只做日期级比较，并留一天余量——墙钟 / UTC
 * 形态的同一天在不同时区可能前后偏一天，宁可多物化几条也不能漏掉实例。
 */
function beforeWindow(
  wallIso: string,
  spanDays: number,
  windowFrom: string,
): boolean {
  return shiftDayKey(wallIso.slice(0, 10), spanDays + 1) < windowFrom;
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
    // 便宜路径：候选日 + 1 天仍早于 UNTIL 的日期时，任何时区下候选都早于
    // 边界（偏移最大 ±14h，跨不过一整天），无需逐候选做时区换算——长序列
    // 里九成候选走这里（SC-020）。反之“已越过边界”最多每条事件命中一次，
    // 因为流在第一个越界候选处就停了。
    if (shiftDayKey(wallIso.slice(0, 10), 1) < until.value.slice(0, 10)) {
      return true;
    }
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
  const timePart = localTimeOfDayLabel(endIso);
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
