import { parseIcsCalendar, type IcsParseIssue } from "../../ics/parse-ics";
import type { CalendarSource } from "../model";
import type { CalendarStore } from "../store/calendar-store";

/**
 * 本地 ICS 导入服务（SC-006 / SRC-001）。
 *
 * 组合方式：解析（纯函数）→ 稳定数据源 → UID upsert 落库 → 源状态更新。
 * 落盘由调用方统一执行（与其他写操作共用一次原子写）。
 *
 * 去重策略（ICS-001）：sourceId 由文件名派生，重复导入同一文件命中
 * 相同 (sourceId, uid, occurrenceId) 键，走 update 而不是新增副本；
 * v0.1 采用增量 upsert（不删除文件中已消失的事件），全量替换语义
 * 留给 WebCal 刷新（SC-007）。
 */

export interface LocalIcsImportInput {
  /** 展示名与 sourceId 派生来源（通常是文件名）。 */
  fileName: string;
  contents: string;
}

export interface LocalIcsImportOutcome {
  /** 文件级失败时不创建数据源，source 为 undefined。 */
  source?: CalendarSource;
  inserted: number;
  updated: number;
  /** 因解析错误被跳过的 VEVENT 数。 */
  skipped: number;
  issues: IcsParseIssue[];
}

const SOURCE_TYPE = "local-ics";

/** 从文件名派生稳定 sourceId：保留 Unicode（中文文件名常见），归一化分隔符。 */
export function sourceIdForLocalIcsFile(fileName: string): string {
  const base = fileName.replace(/\.(ics|ICS)$/, "");
  const slug = base
    .trim()
    .toLowerCase()
    // 路径分隔符与 Windows 保留字符统一成连字符，避免层级 / 保留字语义。
    .replace(/[/\\:.()*?"<>|#&=\s]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `local-ics:${slug || "import"}`;
}

export async function importLocalIcs(
  store: CalendarStore,
  input: LocalIcsImportInput,
): Promise<LocalIcsImportOutcome> {
  const parsed = parseIcsCalendar(input.contents);
  const skipped = parsed.issues.filter(
    (issue) => issue.eventIndex !== undefined,
  ).length;
  const fileLevelFailure =
    parsed.events.length === 0 &&
    parsed.issues.some((issue) => issue.eventIndex === undefined);

  if (fileLevelFailure) {
    return { inserted: 0, updated: 0, skipped, issues: parsed.issues };
  }

  const sourceId = sourceIdForLocalIcsFile(input.fileName);
  const existing = store.listSources().find((source) => source.id === sourceId);
  // 已存在的源保留用户可见配置（enabled / color），只刷新同步状态。
  const source: CalendarSource = existing ?? {
    id: sourceId,
    type: SOURCE_TYPE,
    name: input.fileName,
    enabled: true,
  };
  store.upsertSource(source);
  store.updateSourceStatus(sourceId, {
    lastSyncStatus: "ok",
    lastSyncAt: new Date().toISOString(),
  });

  const { inserted, updated } = store.upsertEvents(
    sourceId,
    parsed.events.map((event) => ({ ...event, sourceId })),
  );
  return {
    // 返回状态刷新后的最终形态，供调用方直接展示。
    source: store.listSources().find((candidate) => candidate.id === sourceId),
    inserted,
    updated,
    skipped,
    issues: parsed.issues,
  };
}
