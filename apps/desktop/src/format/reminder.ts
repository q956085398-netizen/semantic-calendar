import type { EventAlarm } from "../data/model";
import type { ReminderPolicy } from "../semantic/metadata-resolver";

/**
 * 提醒策略 → 用户可读文案（SC-016 展示 / SC-017 调度共用）。
 *
 * 只翻译 Metadata Resolver 给出的策略，不决定什么时候提醒——
 * “什么时候真正触发”属于通知调度器（SC-017）。
 */
export function reminderLabel(policy: ReminderPolicy): string {
  switch (policy.kind) {
    case "minutes-before-start":
      return `赛前 ${policy.minutes} 分钟`;
    case "same-morning":
      return "当天上午";
    case "previous-evening":
      return "前一天晚上";
  }
}

/** 用户设置的比赛提醒提前量 → 同一口径的文案。 */
export function matchReminderLabel(minutes: number): string {
  return `赛前 ${minutes} 分钟`;
}

/**
 * 事件自带提醒（ICS VALARM）→ 用户可读文案。
 * 基准与方向都写出来：只写“提前 30 分钟”会让人以为是相对开始时间。
 */
export function alarmLabel(alarm: EventAlarm): string {
  const amount = minutesToText(alarm.minutes);
  if (alarm.related === "end") {
    return alarm.direction === "before"
      ? `结束前 ${amount}`
      : `结束后 ${amount}`;
  }
  return alarm.direction === "before" ? `提前 ${amount}` : `开始后 ${amount}`;
}

/** 分钟数 → 粗粒度文案（整日 / 整小时 / 分钟），保留原始数值不做四舍五入。 */
function minutesToText(minutes: number): string {
  if (minutes === 0) {
    return "0 分钟";
  }
  if (minutes % 1440 === 0) {
    return `${minutes / 1440} 天`;
  }
  if (minutes % 60 === 0) {
    return `${minutes / 60} 小时`;
  }
  return `${minutes} 分钟`;
}
