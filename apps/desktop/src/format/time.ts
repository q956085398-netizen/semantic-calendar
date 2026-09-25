/**
 * 本地时间格式化（侧栏状态 / 月格摘要 / Inspector / 提醒共用）。
 *
 * `Intl.DateTimeFormat` 的构造约 50µs，比它自己的 format 贵两个数量级，
 * 而这些函数在月格与分桶里是**逐条事件**调用的（SC-020 实测：10,000 条
 * 事件的一次月切换里，仅构造格式化器就占约 80ms）。因此每个格式化器都是
 * 模块级懒加载单例——选项与它自己的缓存槽写在一起，调用点不再各自 new，
 * 也不存在“缓存键与选项各说各话”的可能。
 *
 * 缓存没有失效策略：选项是常量，实例只依赖进程启动时的默认语言与时区。
 * 系统时区 / 语言在应用运行期间改变时，已缓存的实例仍用旧值——与 v0.1
 * 其余“启动时确定”的行为一致，重启后生效。
 */

// 三个懒加载单例：本地 HH:mm、星期几全称（en-US）、日期 + 时间。
let timeHmFormatter: Intl.DateTimeFormat | undefined;
let weekdayLongFormatter: Intl.DateTimeFormat | undefined;
let dateTimeFormatter: Intl.DateTimeFormat | undefined;

function timeHm(): Intl.DateTimeFormat {
  timeHmFormatter ??= new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return timeHmFormatter;
}

function weekdayLong(): Intl.DateTimeFormat {
  weekdayLongFormatter ??= new Intl.DateTimeFormat("en-US", {
    weekday: "long",
  });
  return weekdayLongFormatter;
}

function dateTimeMediumShort(): Intl.DateTimeFormat {
  dateTimeFormatter ??= new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return dateTimeFormatter;
}

/** 本地 HH:mm（24 小时制）：UTC 瞬时按观察者本地时区显示。 */
export function localTimeLabel(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value : "";
  }
  return timeHm().format(date);
}

/**
 * 时间前缀（月格摘要 / 跨天判定共用）：Z 形态按本地时区换算，
 * 墙钟形态已经是观察者时间，直接取 HH:mm。
 */
export function localTimeOfDayLabel(iso: string): string {
  return iso.endsWith("Z") ? localTimeLabel(iso) : iso.slice(11, 16);
}

/** 本地星期几全称（en-US，与赛事信息的语言一致）。 */
export function localWeekdayLabel(date: Date): string {
  return weekdayLong().format(date);
}

/**
 * 本地日期 + 时间（medium / short）。
 * 非法输入原样返回，避免界面出现 “Invalid Date”。
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return dateTimeMediumShort().format(date);
}
