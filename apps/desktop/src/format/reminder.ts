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
