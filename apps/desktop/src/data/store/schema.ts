import type { CalendarSource, StoredEvent, SemanticEvent } from "../model";

/**
 * 增强结果：与原始事件分离存储，Matcher 更新后可整体重建（SEM-004）。
 * 字段与 app-spec §8.5 EnrichedEvent 的附加部分一致。
 */
export interface EventEnrichment {
  semantic?: SemanticEvent;
  metadata?: Record<string, unknown>;
}

/** v0.1 快照形态。修改结构时递增版本并在 migrations.ts 增加迁移。 */
export interface StoreSnapshotV1 {
  schemaVersion: 1;
  sources: CalendarSource[];
  /** 存原始事件；NormalizedEvent 是其超集，可无损入库。 */
  events: StoredEvent[];
  /** 键为 eventKey(sourceId, uid, occurrenceId)。 */
  enrichments: Record<string, EventEnrichment>;
  settings: Record<string, unknown>;
}

export const CURRENT_SCHEMA_VERSION = 1;

/**
 * 结构级校验：只判断分区形态，不逐字段校验业务内容。
 * 不合法的快照按“可恢复异常”处理（隔离 + 重建），避免单个坏文件
 * 让应用完全无法启动。
 */
export function isValidSnapshotShape(data: unknown): boolean {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const snapshot = data as Record<string, unknown>;
  return (
    Array.isArray(snapshot.sources) &&
    Array.isArray(snapshot.events) &&
    typeof snapshot.enrichments === "object" &&
    snapshot.enrichments !== null &&
    !Array.isArray(snapshot.enrichments) &&
    typeof snapshot.settings === "object" &&
    snapshot.settings !== null &&
    !Array.isArray(snapshot.settings)
  );
}
