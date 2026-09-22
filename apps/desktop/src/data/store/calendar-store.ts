import {
  eventKey,
  eventKeyPrefix,
  identityOfEvent,
  type CalendarSource,
  type EnrichedEvent,
  type EventIdentity,
  type SourceSyncStatus,
  type StoredEvent,
} from "../model";
import { migrateAndValidate, readVersion } from "./migrations";
import {
  CURRENT_SCHEMA_VERSION,
  isValidSnapshotShape,
  type EventEnrichment,
  type StoreSnapshotV1,
} from "./schema";
import type { FileIO } from "./file-io";

export type StoreRecoveryReason =
  "corrupt-json" | "invalid-shape" | "future-version";

export interface StoreRecovery {
  reason: StoreRecoveryReason;
  /** 被隔离的原文件路径，数据仍保留在磁盘上供人工检查。 */
  quarantinedTo: string;
}

export interface StoreOpenResult {
  store: CalendarStore;
  recovery?: StoreRecovery;
}

export interface SourceStatusPatch {
  lastSyncStatus?: SourceSyncStatus;
  lastSyncAt?: string;
  lastSyncError?: string;
}

export interface UpsertResult {
  inserted: number;
  updated: number;
}

/**
 * v0.1 本地持久化：单一版本化 JSON 快照 + 原子写。
 *
 * 设计约束：
 * - 原始事件与增强结果分离存储（app-spec §11），Matcher 更新后可重建；
 * - 快照带 schemaVersion，旧数据通过迁移链升级；
 * - 文件损坏 / 结构非法 / 未来版本按“可恢复异常”处理：隔离原文件、
 *   从空快照启动，而不是让应用无法启动；
 * - 单写者模型：同一文件同一时刻只有一个实例写入。
 *
 * 对外只暴露仓储方法，接口按未来可替换 SQLite 适配器的形状设计。
 */
export class CalendarStore {
  private readonly sources = new Map<string, CalendarSource>();
  private readonly events = new Map<string, StoredEvent>();
  private readonly enrichments = new Map<string, EventEnrichment>();
  private readonly settings = new Map<string, unknown>();

  private constructor(
    private readonly fileIO: FileIO,
    readonly filePath: string,
  ) {}

  get schemaVersion(): number {
    return CURRENT_SCHEMA_VERSION;
  }

  static async open(
    fileIO: FileIO,
    filePath: string,
  ): Promise<StoreOpenResult> {
    const text = await fileIO.readFile(filePath);
    if (text === null) {
      return { store: new CalendarStore(fileIO, filePath) };
    }

    const data = parseSnapshot(text);
    if (data === null) {
      return CalendarStore.recover(fileIO, filePath, "corrupt-json");
    }
    const version = readVersion(data);
    if (version !== undefined && !isValidSchemaVersion(version)) {
      return CalendarStore.recover(fileIO, filePath, "invalid-shape");
    }
    if (version !== undefined && version > CURRENT_SCHEMA_VERSION) {
      return CalendarStore.recover(fileIO, filePath, "future-version");
    }

    const migrated = migrateAndValidate(data);
    if (migrated === null) {
      return CalendarStore.recover(fileIO, filePath, "invalid-shape");
    }

    const store = new CalendarStore(fileIO, filePath);
    store.loadSnapshot(migrated);
    return { store };
  }

  // ---- 落盘 ----

  /** 原子写：先写临时文件再 rename，避免崩溃留下半份快照。 */
  async save(): Promise<void> {
    const tmpPath = `${this.filePath}.tmp`;
    await this.fileIO.writeFile(
      tmpPath,
      JSON.stringify(this.toSnapshot(), null, 2),
    );
    await this.fileIO.renameFile(tmpPath, this.filePath);
  }

  toSnapshot(): StoreSnapshotV1 {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      sources: [...this.sources.values()].sort(byId).map(clone),
      events: [...this.events.entries()]
        .sort(([a], [b]) => compareString(a, b))
        .map(([, event]) => clone(event)),
      enrichments: sortedRecord(this.enrichments),
      settings: sortedRecord(this.settings),
    };
  }

  // ---- 数据源（SRC-003）----

  listSources(): CalendarSource[] {
    return [...this.sources.values()].sort(byId).map(clone);
  }

  upsertSource(source: CalendarSource): void {
    this.sources.set(source.id, clone(source));
  }

  updateSourceStatus(id: string, patch: SourceStatusPatch): boolean {
    const source = this.sources.get(id);
    if (!source) {
      return false;
    }
    const next: CalendarSource = { ...source, ...patch };
    if (patch.lastSyncStatus === "ok" && patch.lastSyncError === undefined) {
      delete next.lastSyncError;
    }
    this.sources.set(id, next);
    return true;
  }

  /** 级联删除来源的事件与增强结果。 */
  removeSource(id: string): void {
    this.sources.delete(id);
    this.removeEvents(id);
  }

  // ---- 事件（ICS-001 去重）----

  /** sourceId 以调用方声明为准，防止跨来源数据污染。 */
  upsertEvents(sourceId: string, events: StoredEvent[]): UpsertResult {
    let inserted = 0;
    let updated = 0;
    for (const event of events) {
      const stamped = { ...event, sourceId };
      const key = eventKey(identityOfEvent(stamped));
      if (this.events.has(key)) {
        updated += 1;
        // 内容已更新，旧增强结果失效，等待重新匹配。
        this.enrichments.delete(key);
      } else {
        inserted += 1;
      }
      this.events.set(key, stamped);
    }
    return { inserted, updated };
  }

  listEvents(sourceId?: string): StoredEvent[] {
    return [...this.events.values()]
      .filter((event) => sourceId === undefined || event.sourceId === sourceId)
      .map(clone);
  }

  removeEvents(sourceId: string): void {
    const prefix = eventKeyPrefix(sourceId);
    for (const key of [...this.events.keys()]) {
      if (key.startsWith(prefix)) {
        this.events.delete(key);
        this.enrichments.delete(key);
      }
    }
  }

  /** 整体替换一个来源的事件（WebCal 全量刷新场景）。 */
  replaceSourceEvents(sourceId: string, events: StoredEvent[]): UpsertResult {
    this.removeEvents(sourceId);
    return this.upsertEvents(sourceId, events);
  }

  // ---- 增强结果（SEM-004）----

  saveEnrichment(identity: EventIdentity, enrichment: EventEnrichment): void {
    this.enrichments.set(eventKey(identity), clone(enrichment));
  }

  getEnrichment(identity: EventIdentity): EventEnrichment | undefined {
    const enrichment = this.enrichments.get(eventKey(identity));
    return enrichment === undefined ? undefined : clone(enrichment);
  }

  /** 清除增强结果、保留原始事件；Matcher 更新后从这里重建。 */
  clearEnrichments(sourceId?: string): void {
    if (sourceId === undefined) {
      this.enrichments.clear();
      return;
    }
    const prefix = eventKeyPrefix(sourceId);
    for (const key of [...this.enrichments.keys()]) {
      if (key.startsWith(prefix)) {
        this.enrichments.delete(key);
      }
    }
  }

  /**
   * 读取模型：原始事件 + 增强结果连接为 EnrichedEvent。
   * 事件尚未经过 SC-008 标准化时，normalizedTitle 回退为原标题。
   */
  listEnrichedEvents(sourceId?: string): EnrichedEvent[] {
    return [...this.events.values()]
      .filter((event) => sourceId === undefined || event.sourceId === sourceId)
      .sort(
        (a, b) =>
          compareString(a.start, b.start) || compareString(a.uid, b.uid),
      )
      .map((event) => {
        const enrichment = this.enrichments.get(
          eventKey(identityOfEvent(event)),
        );
        return {
          ...clone(event),
          normalizedTitle: event.normalizedTitle ?? event.title,
          semantic: enrichment?.semantic,
          metadata: enrichment?.metadata,
        };
      });
  }

  // ---- 设置 ----

  getSetting<T = unknown>(key: string, defaultValue?: T): T | undefined {
    if (!this.settings.has(key)) {
      return defaultValue;
    }
    return clone(this.settings.get(key)) as T;
  }

  setSetting(key: string, value: unknown): void {
    this.settings.set(key, clone(value));
  }

  // ---- 内部 ----

  /**
   * 可恢复异常：把问题文件改名隔离（数据保留在磁盘），从空快照继续。
   */
  private static async recover(
    fileIO: FileIO,
    filePath: string,
    reason: StoreRecoveryReason,
  ): Promise<StoreOpenResult> {
    const quarantinedTo = `${filePath}.corrupt-${new Date()
      .toISOString()
      .replace(/[^0-9A-Za-z]+/g, "-")}`;
    await fileIO.renameFile(filePath, quarantinedTo);
    return {
      store: new CalendarStore(fileIO, filePath),
      recovery: { reason, quarantinedTo },
    };
  }

  private loadSnapshot(data: Record<string, unknown>): void {
    if (!isValidSnapshotShape(data)) {
      throw new Error("快照形态未通过校验，不应到达此处");
    }
    const snapshot = data as unknown as StoreSnapshotV1;
    for (const source of snapshot.sources) {
      this.sources.set(source.id, source);
    }
    for (const event of snapshot.events) {
      this.events.set(eventKey(identityOfEvent(event)), event);
    }
    for (const [key, enrichment] of Object.entries(snapshot.enrichments)) {
      this.enrichments.set(key, enrichment);
    }
    for (const [key, value] of Object.entries(snapshot.settings)) {
      this.settings.set(key, value);
    }
  }
}

function parseSnapshot(text: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(text);
    if (typeof data === "object" && data !== null) {
      return data as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** 非法版本号（小数、负数、NaN）按结构异常进入恢复路径，而不是被误读。 */
function isValidSchemaVersion(version: number): boolean {
  return Number.isInteger(version) && version >= 1;
}

function byId(a: { id: string }, b: { id: string }): number {
  return compareString(a.id, b.id);
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedRecord<V>(map: Map<string, V>): Record<string, V> {
  const record: Record<string, V> = {};
  for (const key of [...map.keys()].sort(compareString)) {
    record[key] = map.get(key)!;
  }
  return record;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
