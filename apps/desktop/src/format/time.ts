/**
 * 时间展示格式（侧栏订阅状态 / 数据层状态共用）。
 * 非法输入原样返回，避免界面出现 “Invalid Date”。
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
