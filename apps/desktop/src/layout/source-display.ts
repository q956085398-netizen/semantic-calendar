/**
 * 数据源行的展示规则（SC-006 / SC-007 / SRC-003，侧栏与设置页共用）。
 *
 * 侧栏与设置页共用名称与识别色；同步状态和删除确认只在设置中展示。
 */

import { formatDateTime } from "../format/time";
import { WEBCAL_SOURCE_TYPE, type CalendarSource } from "../data/model";
import { webcalDisplayName, redactWebcalUrl } from "../data/webcal/webcal-url";

/** 旧版用地址作名称的订阅用短名称展示，完整地址留在设置的详情中。 */
export function sourceDisplayName(source: CalendarSource): string {
  if (
    source.type === WEBCAL_SOURCE_TYPE &&
    source.webcal &&
    source.name === webcalDisplayName(source.webcal.url)
  )
    return "订阅日历";
  return source.name;
}

/** 设置中的地址也省略账号及查询串，避免暴露订阅凭据。 */
export function sourceAddress(source: CalendarSource): string | undefined {
  return source.webcal ? redactWebcalUrl(source.webcal.url) : undefined;
}

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
  return `删除${kind}「${sourceDisplayName(source)}」及其全部事件？`;
}
