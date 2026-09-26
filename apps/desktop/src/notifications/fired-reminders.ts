/**
 * 已处理提醒日志（SC-017 / NOTIFY-004 去重、app-spec §11「通知调度状态」）。
 *
 * 一条提醒是否已经弹过，必须跨刷新与重启可见，否则重启或订阅刷新会重复弹。
 * 日志存在快照 settings 里（`notifications.firedReminders`），键是提醒的
 * 稳定去重键（见 reminder-plan 的 PlannedReminder.id）。
 *
 * 保留策略：只保留最近若干天、最多若干条——日志是去重状态，不是历史记录，
 * 无界增长会让每次落盘都变大（P-07 轻量常驻）。
 */

export const FIRED_REMINDERS_SETTING_KEY = "notifications.firedReminders";

/** 保留天数：覆盖“事件改期 / 时钟回拨”这类需要去看旧键的场景。 */
export const FIRED_REMINDER_RETENTION_DAYS = 30;

/** 条数上限：超出时丢最早的条目，保证快照体积有界。 */
export const MAX_FIRED_REMINDERS = 500;

/** 一条提醒的结局：已发送，或已错过发送窗口（不再补发）。 */
export type ReminderOutcome = "fired" | "expired";

export interface HandledReminder {
  /** PlannedReminder.id。 */
  id: string;
  /** 处理时刻（ISO 8601）。 */
  at: string;
  outcome: ReminderOutcome;
}

const RETENTION_MS = FIRED_REMINDER_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * 磁盘值 → 日志：逐条防御性收窄（快照可能被手改）。
 * 时间戳非法或结局未知的条目直接丢弃——它们无法参与去重判断。
 */
export function readHandledReminders(value: unknown): HandledReminder[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: HandledReminder[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const { id, at, outcome } = item as Record<string, unknown>;
    if (typeof id !== "string" || id === "" || typeof at !== "string") {
      continue;
    }
    if (outcome !== "fired" && outcome !== "expired") {
      continue;
    }
    if (Number.isNaN(Date.parse(at))) {
      continue;
    }
    entries.push({ id, at, outcome });
  }
  return entries;
}

/** 已处理提醒 id 集合：计划器据此排除不再触发的提醒。 */
export function handledReminderIds(value: unknown): Set<string> {
  return new Set(readHandledReminders(value).map((entry) => entry.id));
}

/**
 * 记一条提醒为已处理，并顺带裁剪日志。
 * 同 id 重复记录时以最新一次为准（同一提醒不会出现两条记录）。
 */
export function markReminderHandled(
  log: readonly HandledReminder[],
  entry: HandledReminder,
  nowMs: number,
): HandledReminder[] {
  return pruneHandledReminders(
    [...log.filter((item) => item.id !== entry.id), entry],
    nowMs,
  );
}

/** 丢弃过期与超量的条目（保留最新的若干条）。 */
export function pruneHandledReminders(
  log: readonly HandledReminder[],
  nowMs: number,
): HandledReminder[] {
  const kept = log
    .filter((entry) => {
      const at = Date.parse(entry.at);
      return !Number.isNaN(at) && nowMs - at <= RETENTION_MS;
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return kept.slice(Math.max(0, kept.length - MAX_FIRED_REMINDERS));
}
