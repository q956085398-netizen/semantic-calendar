import type { PlannedReminder } from "./reminder-plan";
import type { NotificationPermissionState } from "./notification-bridge";
import { localTimeLabel } from "../format/time";
import { APP_NAME_ZH } from "../settings/app-info";

/**
 * 通知状态文案（SC-017 / app-spec §13「通知权限被禁用：在设置中显示状态」）。
 *
 * 纯函数：把权限、开关、下一条提醒翻译成一句用户能读懂的话。界面上不出现
 * “granted / prompt”这类内部取值，也不在权限不可用时假装一切正常。
 */

/** 状态行输入：权限 + 开关 + 计划摘要 + 最近一次失败说明。 */
export interface NotificationStatusInput {
  enabled: boolean;
  permission: NotificationPermissionState | "unknown";
  /** 待触发提醒条数。 */
  pendingCount: number;
  /** 下一条待触发提醒；没有计划时为 null。 */
  next: Pick<PlannedReminder, "fireAtMs" | "title"> | null;
  nowMs: number;
  /** 最近一次发送失败 / 权限拒绝的用户可读说明。 */
  problem?: string;
}

export function describeNotificationStatus({
  enabled,
  permission,
  pendingCount,
  next,
  nowMs,
  problem,
}: NotificationStatusInput): string {
  if (!enabled) {
    return "通知已关闭：日历照常使用，只是不再弹出提醒";
  }
  if (permission === "unsupported") {
    return "浏览器预览模式：系统通知需要桌面环境";
  }
  if (permission === "denied") {
    return `系统通知权限被拒绝：请在系统设置中允许「${APP_NAME_ZH}」发送通知`;
  }
  if (problem !== undefined) {
    return problem;
  }
  if (permission === "unknown") {
    return "正在读取系统通知权限…";
  }
  if (permission === "prompt") {
    return "系统通知权限待确认：开启提醒时会向系统请求一次";
  }
  if (next === null) {
    return "系统通知已允许；当前没有待触发的提醒";
  }
  const more = pendingCount > 1 ? `（共 ${pendingCount} 条待触发）` : "";
  return `系统通知已允许；下一条提醒：${formatReminderTime(next.fireAtMs, nowMs)} ${next.title}${more}`;
}

/**
 * 是否值得给用户一个“请求系统授权”入口：只在通知开启、且系统还没给出
 * 明确结果时需要（待确认或已被拒绝）。桌面端权限恒为已允许，因此这个入口
 * 实际服务于移动端与“曾经被拒绝”的情形，界面不必为此再判断一次状态。
 */
export function canRequestNotificationPermission(
  permission: NotificationPermissionState | "unknown",
  enabled: boolean,
): boolean {
  return enabled && (permission === "prompt" || permission === "denied");
}

/**
 * 提醒时刻 → 可读文案：当天与次日用“今天 / 明天”，更远用月日，
 * 与月历上的写法保持一致（本地时区）。
 */
export function formatReminderTime(fireAtMs: number, nowMs: number): string {
  const time = localTimeLabel(fireAtMs);
  const dayOffset = localDayOffset(fireAtMs, nowMs);
  if (dayOffset === 0) {
    return `今天 ${time}`;
  }
  if (dayOffset === 1) {
    return `明天 ${time}`;
  }
  if (dayOffset === -1) {
    return `昨天 ${time}`;
  }
  const date = new Date(fireAtMs);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

/** 两个时刻相差几个本地自然日（按当地零点计算）。 */
function localDayOffset(fireAtMs: number, nowMs: number): number {
  const fire = new Date(fireAtMs);
  const now = new Date(nowMs);
  const fireMidnight = new Date(
    fire.getFullYear(),
    fire.getMonth(),
    fire.getDate(),
  ).getTime();
  const nowMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  return Math.round((fireMidnight - nowMidnight) / (24 * 60 * 60 * 1000));
}
