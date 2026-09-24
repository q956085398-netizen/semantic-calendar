/**
 * 数据源行的展示规则（SC-006 / SC-007 / SRC-003，侧栏与设置页共用）。
 *
 * 两处界面（侧栏数据源列表、设置页数据源一节）渲染同一份来源状态，
 * 因此“状态怎么写”“识别色怎么取”只有这一处实现——两边的说法不会漂移。
 */

import { formatDateTime } from "../format/time";
import { WEBCAL_SOURCE_TYPE, type CalendarSource } from "../data/model";

/** 导入源识别色：按 id 派生（增删其他来源不会改变既有颜色）。 */
const SOURCE_COLORS = [
  "var(--source-personal)",
  "var(--source-sport)",
  "var(--source-solar)",
  "var(--source-holiday)",
];

export function sourceColor(sourceId: string): string {
  let hash = 0;
  for (const char of sourceId) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return SOURCE_COLORS[Math.abs(hash) % SOURCE_COLORS.length];
}

/**
 * 来源状态文案（SRC-003）：启停、失败原因与上次成功时间。
 * 失败与上次成功同时展示——失败时用户更需要知道缓存有多旧。
 * 失败原因在落库前已脱敏，这里可以直接展示。
 */
export function sourceStatusText(
  source: CalendarSource,
  refreshing: boolean,
): string {
  const parts: string[] = [];
  if (refreshing) {
    parts.push("刷新中…");
  }
  if (!source.enabled) {
    parts.push("已停用");
  }
  if (source.lastSyncStatus === "error" && source.lastSyncError) {
    parts.push(`刷新失败：${source.lastSyncError}`);
  }
  if (source.lastSyncAt) {
    parts.push(`上次成功 ${formatDateTime(source.lastSyncAt)}`);
  } else if (source.lastSyncStatus !== "error") {
    parts.push("尚未刷新");
  }
  return parts.join(" · ");
}

/** 删除确认文案：订阅与本地导入的来源各自的说法（避免把文件说成订阅）。 */
export function describeSourceRemoval(source: CalendarSource): string {
  const kind = source.type === WEBCAL_SOURCE_TYPE ? "订阅" : "导入来源";
  return `删除${kind}「${source.name}」及其全部事件？`;
}
