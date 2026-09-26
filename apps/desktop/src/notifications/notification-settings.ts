/**
 * 通知设置（SC-017 / NOTIFY-001–003、app-spec §9 SETTINGS）。
 *
 * 通知链路只有两个用户输入：总开关与比赛提醒提前量；去重日志见
 * fired-reminders.ts。坏值一律回落到默认——通知设置读错只会让提醒时间
 * 不对或收不到，宁可回默认也不猜用户意图（P-03）。设置页由 SC-018 接线，
 * 侧栏现在提供同一套键位的入口。
 */

export const NOTIFICATIONS_ENABLED_SETTING_KEY = "notifications.enabled";
export const MATCH_REMINDER_SETTING_KEY = "notifications.matchReminderMinutes";

/** 默认开启：通知是产品能力，用户显式关闭后才不提醒。 */
export const DEFAULT_NOTIFICATIONS_ENABLED = true;

export function normalizeNotificationsEnabled(value: unknown): boolean {
  return value === false ? false : DEFAULT_NOTIFICATIONS_ENABLED;
}

/**
 * 比赛提醒提前量（NOTIFY-003）：
 * - `undefined`：未设置 → 跟随 Metadata Resolver 的建议（默认赛前 30 分钟）；
 * - `null`：用户明确选择“不提醒”；
 * - `number`：用户设置的提前分钟数（用户设置优先）。
 *
 * 三种状态必须区分：`undefined` 与 `null` 在界面上是“跟随默认”与“关闭”，
 * 合并成同一个值会丢掉用户的一次明确选择。
 */
export type MatchReminderSetting = number | null | undefined;

export function normalizeMatchReminderSetting(
  value: unknown,
): MatchReminderSetting {
  if (value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  return undefined;
}

export interface MatchReminderOption {
  /** 表单取值；数字提前量用十进制字符串表示。 */
  value: string;
  label: string;
}

/**
 * 可选项与顺序：跟随默认 → 具体提前量 → 不提醒（与侧栏展示顺序一致）。
 *
 * `defaultLabel` 由调用方用 Metadata Resolver 的建议翻译给出（例如“赛前 30 分钟”），
 * 界面上就不必再抄一份默认值——默认值只有 Resolver 一处来源。
 */
export function matchReminderOptions(
  defaultLabel?: string,
): MatchReminderOption[] {
  return [
    {
      value: "default",
      label:
        defaultLabel === undefined
          ? "跟随默认建议"
          : `跟随默认建议（${defaultLabel}）`,
    },
    { value: "60", label: "提前 60 分钟" },
    { value: "30", label: "提前 30 分钟" },
    { value: "15", label: "提前 15 分钟" },
    { value: "10", label: "提前 10 分钟" },
    { value: "off", label: "不提醒" },
  ];
}

/** 设置值 → 表单取值；不在选项内的自定义分钟数按数字回显（快照可能是手写的）。 */
export function matchReminderOptionValue(
  setting: MatchReminderSetting,
): string {
  if (setting === null) {
    return "off";
  }
  return setting === undefined ? "default" : String(setting);
}

/**
 * 当前值对应的下拉选项：快照里的自定义分钟数（例如手写的 45）不在预置选项
 * 里，补一条，否则下拉框会显示成空白，看起来像“设置丢了”。
 */
export function matchReminderOptionsFor(
  setting: MatchReminderSetting,
  defaultLabel?: string,
): MatchReminderOption[] {
  const options = matchReminderOptions(defaultLabel);
  const current = matchReminderOptionValue(setting);
  if (options.some((option) => option.value === current)) {
    return options;
  }
  return [
    ...options,
    { value: current, label: matchReminderOptionLabel(setting, defaultLabel) },
  ];
}

/** 表单取值 → 设置值；非法取值回落到“跟随默认建议”。 */
export function matchReminderSettingFromOption(
  value: string,
): MatchReminderSetting {
  if (value === "off") {
    return null;
  }
  if (value === "default") {
    return undefined;
  }
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0
    ? Math.round(minutes)
    : undefined;
}

/** 选项文案：自定义分钟数不在预置选项里时补一条，避免下拉框出现空值。 */
export function matchReminderOptionLabel(
  setting: MatchReminderSetting,
  defaultLabel?: string,
): string {
  const value = matchReminderOptionValue(setting);
  const known = matchReminderOptions(defaultLabel).find(
    (option) => option.value === value,
  );
  return known?.label ?? `提前 ${value} 分钟`;
}
