import {
  eventKey,
  identityOfEvent,
  type EnrichedEvent,
  type EventAlarm,
} from "../data/model";
import { dateFromKey } from "../calendar/month-grid";
import { eventTimeLabel } from "../calendar/event-display";
import {
  displayMetadataOf,
  type ReminderPolicy,
} from "../semantic/metadata-resolver";
import {
  alarmLabel,
  matchReminderLabel,
  reminderLabel,
} from "../format/reminder";
import type { MatchReminderSetting } from "./notification-settings";

/**
 * 提醒计划（SC-017 / NOTIFY-002–004）。
 *
 * 纯函数：给定事件与设置，算出“什么时候该弹什么”，不发送、不落盘、
 * 不读时钟（`nowMs` 由调用方传入）。因此提醒时间可以在测试里逐条断言，
 * 调度器只负责到点调用。
 *
 * 一条提醒的来源按以下优先级取（高者胜，见 README「通知与提醒」）：
 * 1. 用户设置（仅比赛；含“不提醒”）——NOTIFY-003 的“用户设置优先”；
 * 2. 事件自带的 VALARM（NOTIFY-002 的“事件自身 alarm”）；
 * 3. Metadata Resolver 的提醒策略（如比赛的默认赛前 30 分钟建议）。
 *
 * 同一条提醒的去重键由「事件身份 + 触发时刻 + 来源」组成（NOTIFY-004）：
 * 刷新订阅 / 重启会重建出完全相同的键，因此不会重复弹；事件被改期则触发
 * 时刻变化，会作为一条新提醒弹出——这是用户真正想要的语义。
 */

/** 计划窗口（天）：更远的提醒等时间靠近再算，避免为远期事件做无谓计算。 */
export const REMINDER_HORIZON_DAYS = 30;

/** 迟到容忍窗口：超过这个时长就不再补发（例如应用整天没开）。 */
export const REMINDER_LATE_TOLERANCE_MS = 2 * 60 * 60 * 1000;

/** “当天上午 / 前一天晚上”两个策略锚点的本地时刻（v0.1 固定值）。 */
export const MORNING_ANCHOR_HOUR = 9;
export const EVENING_ANCHOR_HOUR = 20;

/** 提醒来源：用户设置 / 事件自带 / 默认建议。 */
export type ReminderSource = "user-setting" | "event-alarm" | "resolver-policy";

export interface PlannedReminder {
  /** 稳定去重键（NOTIFY-004）；同一事件同一触发时刻只算一条。 */
  id: string;
  /** 事件持久化身份，便于追溯这条提醒属于哪个事件。 */
  eventId: string;
  /** 触发时刻（epoch ms）。 */
  fireAtMs: number;
  /** 通知标题：事件标题，不外泄描述与地址（app-spec §14）。 */
  title: string;
  /** 通知正文：开始时间 + 提醒依据。 */
  body: string;
  source: ReminderSource;
}

export interface PlanRemindersInput {
  /** 事件（重复规则已展开为具体 occurrence，见 normalize/occurrences）。 */
  events: readonly EnrichedEvent[];
  /** 通知总开关；关闭时不存在任何计划。 */
  notificationsEnabled: boolean;
  /** 比赛提醒提前量（用户设置）。 */
  matchReminder: MatchReminderSetting;
  nowMs: number;
  /** 已处理（已发送 / 已错过）的提醒 id，不再进入计划。 */
  handledIds?: ReadonlySet<string>;
  horizonDays?: number;
}

export function planReminders({
  events,
  notificationsEnabled,
  matchReminder,
  nowMs,
  handledIds,
  horizonDays = REMINDER_HORIZON_DAYS,
}: PlanRemindersInput): PlannedReminder[] {
  if (!notificationsEnabled) {
    return [];
  }
  const horizonEndMs = nowMs + horizonDays * 24 * 60 * 60 * 1000;
  const planned: PlannedReminder[] = [];

  for (const event of events) {
    if (event.cancelled) {
      continue;
    }
    const startMs = startInstantMs(event);
    if (startMs === undefined) {
      continue;
    }
    const endMs = endInstantMs(event, startMs);
    for (const candidate of reminderCandidates(event, matchReminder)) {
      const fireAtMs = candidate.fireTime(startMs, endMs);
      // 按固定时刻锚定的策略（当天上午 / 前一天晚上）在事件已经结束后没有意义：
      // 早上 9 点的提醒不该为 07:00 的会议弹出。相对事件的提醒（提前 N 分钟 /
      // 事件自带 alarm）由来源决定，不做这层裁剪——那是来源明确要求的时间。
      if (candidate.dayAnchored && fireAtMs > endMs) {
        continue;
      }
      if (fireAtMs > horizonEndMs) {
        continue;
      }
      const id = reminderId(event, candidate.signature, fireAtMs);
      if (handledIds?.has(id)) {
        continue;
      }
      planned.push({
        id,
        eventId: eventKey(identityOfEvent(event)),
        fireAtMs,
        title: eventTitleOf(event),
        body: `${eventTimeLabel(event) || "全天"} · ${candidate.label}`,
        source: candidate.source,
      });
    }
  }

  planned.sort((a, b) => a.fireAtMs - b.fireAtMs || compareId(a.id, b.id));
  return planned;
}

/** 当前已到期的提醒（`fireAt <= now`），按时间升序；已错过的也在其中。 */
export function dueReminders(
  reminders: readonly PlannedReminder[],
  nowMs: number,
): PlannedReminder[] {
  return reminders.filter((reminder) => reminder.fireAtMs <= nowMs);
}

/**
 * 已经错过容忍窗口的提醒：不再补发（NOTIFY-004 的“不重复”同样包含
 * “事后突然补一堆旧提醒”），由调用方记为已处理。
 */
export function expiredReminders(
  reminders: readonly PlannedReminder[],
  nowMs: number,
): PlannedReminder[] {
  return reminders.filter(
    (reminder) => nowMs - reminder.fireAtMs > REMINDER_LATE_TOLERANCE_MS,
  );
}

/** 距离下一条提醒的毫秒数（已到期即 0）；没有计划时为 null。 */
export function nextReminderDelay(
  reminders: readonly PlannedReminder[],
  nowMs: number,
): number | null {
  const next = nextReminder(reminders);
  return next === null ? null : Math.max(0, next.fireAtMs - nowMs);
}

/**
 * 下一条待触发提醒（包含已到期、尚未处理的那条）；没有计划时为 null。
 * 已到期返回 0 延迟由调度器处理，因此这里不再区分过去与未来。
 */
export function nextReminder(
  reminders: readonly PlannedReminder[],
): PlannedReminder | null {
  let next: PlannedReminder | null = null;
  for (const reminder of reminders) {
    if (next === null || reminder.fireAtMs < next.fireAtMs) {
      next = reminder;
    }
  }
  return next;
}

/**
 * 事件开始时刻 → 本地瞬时毫秒。
 * - 全天事件：当日当地 00:00（ICS-002 不做时区换算，按观察者本地日理解）；
 * - `Z` 结尾：绝对瞬时；
 * - 浮动 / TZID 墙钟：按观察者本地时间理解（与 eventTimeLabel 同一口径）。
 * 无法解释的值返回 undefined：不猜时间（P-03）。
 */
export function startInstantMs(
  event: Pick<EnrichedEvent, "start" | "allDay">,
): number | undefined {
  const iso = event.start;
  if (typeof iso !== "string" || iso.length < 10) {
    return undefined;
  }
  if (event.allDay) {
    return msOfDateKey(iso.slice(0, 10));
  }
  return iso.endsWith("Z") ? msOfIso(iso) : msOfWallClock(iso);
}

/**
 * 事件结束时刻 → 本地瞬时毫秒；没有结束时间时给出该事件的“事件已结束”边界：
 * - 全天事件：当天结束（次日 00:00）；
 * - 时间事件：等于开始时刻（RFC 5545 对无 DTEND 的 DATE-TIME 事件即零时长）。
 */
export function endInstantMs(
  event: Pick<EnrichedEvent, "start" | "end" | "allDay">,
  startMs: number,
): number {
  const end = event.end;
  if (typeof end === "string" && end.length >= 10) {
    if (event.allDay) {
      const endMs = msOfDateKey(end.slice(0, 10));
      if (endMs !== undefined) {
        return endMs;
      }
    } else {
      const endMs = end.endsWith("Z") ? msOfIso(end) : msOfWallClock(end);
      if (endMs !== undefined) {
        return endMs;
      }
    }
  }
  return event.allDay ? startMs + 24 * 60 * 60 * 1000 : startMs;
}

/**
 * 事件 → 该事件的提醒候选（按优先级取一组，可能多条：事件可带多个 VALARM）。
 * 返回空数组表示这个事件不提醒。
 */
function reminderCandidates(
  event: ReminderSourceEvent,
  matchReminder: MatchReminderSetting,
): ReminderCandidate[] {
  const isMatch = event.semantic?.type === "sport.fixture";
  if (isMatch && matchReminder === null) {
    return [];
  }
  if (isMatch && typeof matchReminder === "number") {
    return [
      {
        signature: `user:${matchReminder}`,
        source: "user-setting",
        label: matchReminderLabel(matchReminder),
        dayAnchored: false,
        fireTime: (startMs) => startMs - matchReminder * 60_000,
      },
    ];
  }
  // 事件自带的提醒是来源数据，比“建议策略”更具体（NOTIFY-002）。
  const alarms = event.alarms ?? [];
  if (alarms.length > 0) {
    return alarms.map((alarm, index) => alarmCandidate(alarm, index));
  }
  const policy = displayMetadataOf(event)?.reminder;
  return policy === undefined ? [] : [policyCandidate(policy)];
}

/** 计划与展示所需的最少字段：比赛语义、事件自带提醒、增强元数据。 */
export type ReminderSourceEvent = Pick<
  EnrichedEvent,
  "semantic" | "alarms" | "metadata"
>;

/** 一个事件的提醒说明（ui-design §13 的“提醒”行）。 */
export interface EventReminderDescription {
  /** 「建议提醒」= Resolver 的建议；「提醒」= 用户设置或事件自带。 */
  label: string;
  /** 策略文案；用户明确关闭时写明“已关闭（用户设置）”。 */
  detail: string;
}

/**
 * 事件的提醒说明：与计划器共用同一套优先级，所以界面上的说法
 * 等于真正会发生的事。没有可说的提醒时返回 undefined（不填占位）。
 */
export function describeEventReminder(
  event: ReminderSourceEvent,
  matchReminder: MatchReminderSetting,
): EventReminderDescription | undefined {
  if (event.semantic?.type === "sport.fixture" && matchReminder === null) {
    return { label: "提醒", detail: "已关闭（用户设置）" };
  }
  const candidates = reminderCandidates(event, matchReminder);
  if (candidates.length === 0) {
    return undefined;
  }
  const suggested = candidates.every(
    (candidate) => candidate.source === "resolver-policy",
  );
  return {
    // 默认建议不是事件数据，因此写“建议提醒”；用户设置与事件自带提醒
    // 都是确定会发生的事，写“提醒”并标出来源。
    label: suggested ? "建议提醒" : "提醒",
    detail: candidates
      .map((candidate) =>
        candidate.source === "resolver-policy"
          ? candidate.label
          : `${candidate.label}（${SOURCE_LABELS[candidate.source]}）`,
      )
      .join("、"),
  };
}

const SOURCE_LABELS: Record<
  Exclude<ReminderSource, "resolver-policy">,
  string
> = {
  "user-setting": "用户设置",
  "event-alarm": "事件自带",
};

interface ReminderCandidate {
  /** 去重键的一部分：描述这条提醒的依据。 */
  signature: string;
  source: ReminderSource;
  /** 用户可读的策略文案（进通知正文）。 */
  label: string;
  /** 是否按固定时刻锚定（当天上午 / 前一天晚上）。 */
  dayAnchored: boolean;
  fireTime: (startMs: number, endMs: number) => number;
}

function alarmCandidate(alarm: EventAlarm, index: number): ReminderCandidate {
  const label = alarmLabel(alarm);
  return {
    // 序号参与签名：同一个事件重复两条相同偏移的 VALARM 时仍是两条提醒。
    signature: `alarm:${index}:${alarm.related}:${alarm.direction}:${alarm.minutes}`,
    source: "event-alarm",
    label,
    dayAnchored: false,
    fireTime: (startMs, endMs) => {
      const base = alarm.related === "end" ? endMs : startMs;
      const delta = alarm.minutes * 60_000;
      return alarm.direction === "before" ? base - delta : base + delta;
    },
  };
}

function policyCandidate(policy: ReminderPolicy): ReminderCandidate {
  const label = reminderLabel(policy);
  return {
    signature: `policy:${policySignature(policy)}`,
    source: "resolver-policy",
    label,
    dayAnchored: policy.kind !== "minutes-before-start",
    fireTime: (startMs) => {
      switch (policy.kind) {
        case "minutes-before-start":
          return startMs - policy.minutes * 60_000;
        case "same-morning":
          return anchorMs(startMs, 0, MORNING_ANCHOR_HOUR);
        case "previous-evening":
          return anchorMs(startMs, -1, EVENING_ANCHOR_HOUR);
      }
    },
  };
}

function policySignature(policy: ReminderPolicy): string {
  return policy.kind === "minutes-before-start"
    ? `minutes-before-start:${policy.minutes}`
    : policy.kind;
}

/** 以事件开始日（可偏移天数）的本地 `hour:00` 为锚点。 */
function anchorMs(baseMs: number, dayOffset: number, hour: number): number {
  const date = new Date(baseMs);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + dayOffset,
    hour,
    0,
    0,
    0,
  ).getTime();
}

function reminderId(
  event: EnrichedEvent,
  signature: string,
  fireAtMs: number,
): string {
  return `${eventKey(identityOfEvent(event))}\u0000${signature}\u0000${fireAtMs}`;
}

/** 通知标题：原始标题优先，避免把标准化产物当成用户看到的名字。 */
function eventTitleOf(event: EnrichedEvent): string {
  const title = event.title?.trim();
  if (title !== undefined && title !== "") {
    return title;
  }
  const normalized = event.normalizedTitle?.trim();
  return normalized !== undefined && normalized !== ""
    ? normalized
    : "未命名事件";
}

function msOfDateKey(dateKey: string): number | undefined {
  const ms = dateFromKey(dateKey).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

function msOfIso(iso: string): number | undefined {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

/** 无偏移墙钟 ISO → 观察者本地瞬时；分量非法返回 undefined。 */
function msOfWallClock(iso: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(
    iso,
  );
  if (match === null) {
    return undefined;
  }
  const [, year, month, day, hour, minute, second] = match;
  const ms = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? "0"),
  ).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
