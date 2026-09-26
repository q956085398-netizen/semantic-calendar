import { CURRENT_SCHEMA_VERSION, isValidSnapshotShape } from "./schema";

/**
 * 快照迁移链。每个迁移把 from 版本的数据推进到 to 版本。
 * 修改快照结构时：递增 CURRENT_SCHEMA_VERSION 并在此追加迁移，
 * 保证旧版本数据文件在新版本应用中仍可打开。
 */
export interface SnapshotMigration {
  from: number;
  to: number;
  migrate(data: Record<string, unknown>): Record<string, unknown>;
}

/**
 * v0（无 schemaVersion 字段的早期快照）→ v1：
 * 补上默认分区并标记版本，保留已有的来源、事件与设置。
 */
const legacyToV1: SnapshotMigration = {
  from: 0,
  to: 1,
  migrate(data) {
    return {
      ...data,
      schemaVersion: 1,
      sources: Array.isArray(data.sources) ? data.sources : [],
      events: Array.isArray(data.events) ? data.events : [],
      enrichments:
        typeof data.enrichments === "object" && data.enrichments !== null
          ? data.enrichments
          : {},
      settings:
        typeof data.settings === "object" && data.settings !== null
          ? data.settings
          : {},
    };
  },
};

export const SNAPSHOT_MIGRATIONS: readonly SnapshotMigration[] = [legacyToV1];

export class MissingMigrationError extends Error {
  constructor(public readonly fromVersion: number) {
    super(`缺少从 schema v${fromVersion} 开始的迁移`);
    this.name = "MissingMigrationError";
  }
}

/** 按版本顺序推进数据，直到达到 targetVersion。 */
export function migrateSnapshot(
  data: Record<string, unknown>,
  migrations: readonly SnapshotMigration[],
  targetVersion: number,
): Record<string, unknown> {
  let current = data;
  let version = readVersion(current) ?? 0;

  while (version < targetVersion) {
    const migration = migrations.find((m) => m.from === version);
    if (!migration) {
      throw new MissingMigrationError(version);
    }
    current = migration.migrate(current);
    version = migration.to;
  }

  return current;
}

/** 缺失版本字段的快照视为 legacy v0；类型不合法时返回 undefined，由调用方按结构异常处理。 */
export function readVersion(data: Record<string, unknown>): number | undefined {
  return typeof data.schemaVersion === "number"
    ? data.schemaVersion
    : undefined;
}

/** 迁移结果必须仍是合法形态，否则按可恢复异常处理。 */
export function migrateAndValidate(
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const migrated = migrateSnapshot(
    data,
    SNAPSHOT_MIGRATIONS,
    CURRENT_SCHEMA_VERSION,
  );
  return isValidSnapshotShape(migrated) ? migrated : null;
}
