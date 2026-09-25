/**
 * 性能基线的固定工作负载（SC-020 / app-spec §15）。
 *
 * 基线要能重复：同一份生成器在任何机器上产出相同的输入，所以字段全部由
 * 下标算术推导——不使用随机数、不读时钟、不依赖运行机器的时区。事件分布
 * 贴近真实日历：定时 / 全天 / 重复 / 例外 / 提醒 / 英超比赛按固定比例混合；
 * 英超比赛是必须的，否则 Matcher 批处理测的是一路空转。
 *
 * 两条入口共用同一份形状定义：
 * - `buildIcsFixture`：序列化成 ICS 文本，走完整的解析 + 标准化链路；
 * - `buildStoredEvents`：直接构造入库事件，用来隔离测量存储 / 匹配阶段。
 */

import { shiftDayKey } from "../calendar/date-keys";
import { occurrenceWindowOf } from "../calendar/month-occurrences";
import { buildMonthGrid, formatDateKey } from "../calendar/month-grid";
import type { EventAlarm, RawCalendarEvent, StoredEvent } from "../data/model";
import type { OccurrenceWindow } from "../normalize/occurrences";
import { normalizeEventForStorage } from "../normalize/normalizer";
import { footballCatalog } from "../providers/football/football-catalog";

/** 基线使用的两档事件量（app-spec §15：1,000 / 10,000）。 */
export const EVENT_COUNTS = [1_000, 10_000] as const;

/** 固定日历起点：与真实时钟无关，重复运行得到同一批日期。 */
const FIXTURE_ORIGIN = "2026-01-01";

/** 固定时区：TZID 事件用来覆盖墙钟 → UTC 换算这一段。 */
const FIXTURE_TZID = "Europe/London";

/**
 * 事件形态表：20 个位置一轮，比例固定（下标 % 20 决定形态）。
 * 重复规则只取解析层支持且真实日历常见的几种。
 */
const KINDS = [
  "timed-utc",
  "timed-tzid",
  "all-day",
  "weekly",
  "fixture",
  "alarm",
  "timed-utc",
  "all-day-span",
  "timed-tzid",
  "monthly",
  "fixture",
  "timed-utc",
  "weekly-exception",
  "alarm",
  "all-day",
  "timed-utc",
  "daily-exdate",
  "timed-tzid",
  "timed-utc",
  "fixture",
] as const;

/** 单个固定事件：ICS 文本与入库事件由它派生，两条路径不会各说各话。 */
interface FixtureEvent {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  allDay: boolean;
  /** 全天为日期键，Z 形态为 `…ss.000Z`，墙钟形态无后缀。 */
  start: string;
  end?: string;
  startTzid?: string;
  endTzid?: string;
  rrule?: string;
  /** EXDATE 原值（ICS 紧凑形态，与解析器落库的形状一致）。 */
  exdate?: string;
  alarms?: EventAlarm[];
  /** weekly-exception 形态：被取消的例外实例的 RECURRENCE-ID（与 start 同形态）。 */
  cancelledOccurrence?: string;
}

/**
 * 英超对阵池：从真实目录的赛季名单里成对取队，保证两队同属一季
 * （Matcher 会查“两队同属某季名单”，写死队名会在名单变化后静默失效）。
 */
const FIXTURE_PAIRS: readonly (readonly [string, string])[] =
  fixturePairsFromCatalog();

function fixturePairsFromCatalog(): readonly (readonly [string, string])[] {
  const season = footballCatalog.latestSeason();
  const names = (season ? footballCatalog.rosterOf(season.id) : []).map(
    (team) => team.name,
  );
  const pairs: [string, string][] = [];
  for (let index = 0; index + 1 < names.length; index += 2) {
    pairs.push([names[index], names[index + 1]]);
  }
  // 目录为空时不该发生（装配期校验会先抛错）；保留一条兜底对阵让基线仍可运行。
  return pairs.length > 0 ? pairs : [["Arsenal", "Manchester City"]];
}

const cache = new Map<number, readonly FixtureEvent[]>();

/** 固定事件序列；同一 eventCount 只生成一次，多次测量共用同一份输入。 */
export function fixtureEvents(eventCount: number): readonly FixtureEvent[] {
  const cached = cache.get(eventCount);
  if (cached !== undefined) {
    return cached;
  }
  const events: FixtureEvent[] = [];
  for (let index = 0; index < eventCount; index += 1) {
    events.push(fixtureEventAt(index));
  }
  cache.set(eventCount, events);
  return events;
}

function fixtureEventAt(index: number): FixtureEvent {
  const kind = KINDS[index % KINDS.length];
  const day = shiftDayKey(FIXTURE_ORIGIN, index % 365);
  const hour = 7 + (index % 14);
  const minute = (index * 7) % 60;
  const uid = `perf-${index}@semantic-calendar.test`;

  if (kind === "all-day" || kind === "all-day-span") {
    const span = kind === "all-day-span" ? 1 + (index % 3) : 0;
    return {
      uid,
      title: `全天安排 ${index}`,
      allDay: true,
      start: day,
      ...(span > 0 && { end: shiftDayKey(day, span + 1) }),
      ...(index % 3 === 0 && { location: `会议室 ${index % 8}` }),
    };
  }

  if (kind === "weekly" || kind === "weekly-exception") {
    const tzid = index % 2 === 0 ? FIXTURE_TZID : undefined;
    const event: FixtureEvent = {
      uid,
      title: `每周例会 ${index}`,
      description: "固定周会，含议程与参会人列表，用来拉近真实快照体积。",
      allDay: false,
      start: timedStart(day, hour, minute, tzid),
      ...(tzid !== undefined && { startTzid: tzid }),
      // COUNT 与 UNTIL 各占一半：真实订阅两种都有，而 UNTIL 的 UTC 形态
      // 在 TZID master 上会走换算分支（展开器的另一条代价路径）。
      rrule:
        index % 2 === 0
          ? "FREQ=WEEKLY;UNTIL=20261231T235900Z"
          : "FREQ=WEEKLY;COUNT=40",
      ...(index % 3 === 0 && {
        location: `线上会议 ${index % 5}`,
        alarms: [{ minutes: 15, direction: "before", related: "start" }],
      }),
    };
    if (kind === "weekly-exception") {
      // 取消其中一个实例：展开时走 RECURRENCE-ID 例外分支。
      event.cancelledOccurrence = timedStart(
        shiftDayKey(day, 14),
        hour,
        minute,
        tzid,
      );
    }
    return event;
  }

  if (kind === "monthly") {
    return {
      uid,
      title: `月度复盘 ${index}`,
      allDay: false,
      start: timedStart(day, hour, minute),
      rrule: "FREQ=MONTHLY;COUNT=24",
    };
  }

  if (kind === "daily-exdate") {
    return {
      uid,
      title: `隔日巡检 ${index}`,
      allDay: false,
      start: timedStart(day, hour, minute),
      rrule: "FREQ=DAILY;INTERVAL=3;COUNT=30",
      exdate: `${shiftDayKey(day, 9).replace(/-/g, "")}T${pad(hour)}${pad(minute)}00Z`,
    };
  }

  if (kind === "fixture") {
    const pair = FIXTURE_PAIRS[index % FIXTURE_PAIRS.length];
    return {
      uid,
      title:
        index % 3 === 0
          ? `Premier League: ${pair[0]} vs ${pair[1]}`
          : `${pair[0]} vs ${pair[1]}`,
      allDay: false,
      start: timedStart(day, hour, minute, FIXTURE_TZID),
      end: timedStart(day, hour + 2, minute, FIXTURE_TZID),
      startTzid: FIXTURE_TZID,
      endTzid: FIXTURE_TZID,
      ...(index % 2 === 0 && { location: "Emirates Stadium" }),
    };
  }

  if (kind === "alarm") {
    return {
      uid,
      title: `提醒事项 ${index}`,
      description: "带 VALARM 的普通事件。",
      allDay: false,
      start: timedStart(day, hour, minute),
      alarms: [{ minutes: 30, direction: "before", related: "start" }],
    };
  }

  if (kind === "timed-tzid") {
    return {
      uid,
      title: `伦敦客户通话 ${index}`,
      allDay: false,
      start: timedStart(day, hour, minute, FIXTURE_TZID),
      startTzid: FIXTURE_TZID,
      ...(index % 4 === 0 && {
        location: "Zoom",
        description: "跨时区通话，用来覆盖 TZID 墙钟换算。",
      }),
    };
  }

  return {
    uid,
    title: `工作事项 ${index}`,
    allDay: false,
    start: timedStart(day, hour, minute),
    ...(index % 2 === 0 && {
      description: "普通定时事件，含一段描述以接近真实快照体积。",
    }),
  };
}

/** 入库事件（解析 + 标准化之后的形态），供存储 / 匹配 / 展开类基线使用。 */
export function buildStoredEvents(
  eventCount: number,
  sourceId = "local-ics:perf",
): StoredEvent[] {
  const stored: StoredEvent[] = [];
  for (const event of fixtureEvents(eventCount)) {
    stored.push(normalizeEventForStorage(rawEventOf(event, sourceId)));
    if (event.cancelledOccurrence !== undefined) {
      stored.push(
        normalizeEventForStorage({
          ...rawEventOf(event, sourceId),
          occurrenceId: event.cancelledOccurrence,
          cancelled: true,
        }),
      );
    }
  }
  return stored;
}

/** ICS 文本：与 buildStoredEvents 同源，覆盖解析 → 标准化整条导入链路。 */
export function buildIcsFixture(eventCount: number): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Semantic Calendar//Performance Fixture//CN",
  ];
  for (const event of fixtureEvents(eventCount)) {
    lines.push(...veventLines(event));
    if (event.cancelledOccurrence !== undefined) {
      lines.push(...cancelledOverrideLines(event));
    }
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * 月视图实际展开的窗口（含前后补格）。口径只有一处：直接问 App 用的那个
 * 函数（calendar/month-occurrences），夹具不另抄一份。
 */
export function monthWindow(year: number, month: number): OccurrenceWindow {
  return occurrenceWindowOf(
    buildMonthGrid({ year, month, today: formatDateKey(year, month, 1) }),
  );
}

function rawEventOf(event: FixtureEvent, sourceId: string): RawCalendarEvent {
  return {
    uid: event.uid,
    sourceId,
    title: event.title,
    ...(event.description !== undefined && { description: event.description }),
    ...(event.location !== undefined && { location: event.location }),
    start: event.start,
    ...(event.end !== undefined && { end: event.end }),
    allDay: event.allDay,
    ...(event.startTzid !== undefined && { startTzid: event.startTzid }),
    ...(event.endTzid !== undefined && { endTzid: event.endTzid }),
    ...((event.rrule !== undefined || event.exdate !== undefined) && {
      recurrence: {
        ...(event.rrule !== undefined && { rrule: event.rrule }),
        exdates: event.exdate === undefined ? [] : [{ value: event.exdate }],
      },
    }),
    ...(event.alarms !== undefined && { alarms: event.alarms }),
  };
}

function veventLines(event: FixtureEvent): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${event.uid}`, `SUMMARY:${event.title}`];
  if (event.description !== undefined) {
    lines.push(`DESCRIPTION:${event.description}`);
  }
  if (event.location !== undefined) {
    lines.push(`LOCATION:${event.location}`);
  }
  lines.push(...dateLines(event));
  if (event.rrule !== undefined) {
    lines.push(`RRULE:${event.rrule}`);
  }
  if (event.exdate !== undefined) {
    lines.push(`EXDATE:${event.exdate}`);
  }
  if (event.alarms !== undefined) {
    for (const alarm of event.alarms) {
      lines.push(
        "BEGIN:VALARM",
        `TRIGGER:${alarm.direction === "before" ? "-" : "+"}PT${alarm.minutes}M`,
        "ACTION:DISPLAY",
        `DESCRIPTION:${event.title}`,
        "END:VALARM",
      );
    }
  }
  lines.push("END:VEVENT");
  return lines;
}

/** 取消例外：与 master 同 UID，带 RECURRENCE-ID 与 STATUS:CANCELLED。 */
function cancelledOverrideLines(event: FixtureEvent): string[] {
  const recurrenceId = event.cancelledOccurrence ?? event.start;
  const param = event.startTzid === undefined ? "" : `;TZID=${event.startTzid}`;
  return [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `SUMMARY:${event.title}`,
    `RECURRENCE-ID${param}:${icsStamp(recurrenceId)}`,
    ...dateLines({ ...event, start: recurrenceId, end: undefined }),
    "STATUS:CANCELLED",
    "END:VEVENT",
  ];
}

function dateLines(event: FixtureEvent): string[] {
  if (event.allDay) {
    const lines = [`DTSTART;VALUE=DATE:${event.start.replace(/-/g, "")}`];
    if (event.end !== undefined) {
      lines.push(`DTEND;VALUE=DATE:${event.end.replace(/-/g, "")}`);
    }
    return lines;
  }
  const param = event.startTzid === undefined ? "" : `;TZID=${event.startTzid}`;
  const lines = [`DTSTART${param}:${icsStamp(event.start)}`];
  if (event.end !== undefined) {
    const endParam =
      event.endTzid === undefined ? "" : `;TZID=${event.endTzid}`;
    lines.push(`DTEND${endParam}:${icsStamp(event.end)}`);
  }
  return lines;
}

/** 定时事件起点：无时区为 Z 形态（与解析器产出的 ISO 形态一致），有则墙钟。 */
function timedStart(
  day: string,
  hour: number,
  minute: number,
  tzid?: string,
): string {
  const stamp = `${pad(hour)}:${pad(minute)}:00`;
  return tzid === undefined ? `${day}T${stamp}.000Z` : `${day}T${stamp}`;
}

/** ISO → ICS 紧凑形态（去掉分隔符与毫秒；形态本身由调用方决定，不补 Z）。 */
function icsStamp(iso: string): string {
  return iso.replace(/\.\d+/, "").replace(/[-:]/g, "");
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
