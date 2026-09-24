import {
  asNormalizedEvent,
  eventKey,
  eventKeyPrefix,
  identityOfEvent,
  type CalendarSource,
  type EnrichedEvent,
  type EventIdentity,
  type SourceSyncStatus,
  type StoredEvent,
  type WebcalCache,
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

export interface ReplaceResult extends UpsertResult {
  /** 本次批次中已消失、被删除的事件数。 */
  removed: number;
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
  /** save() 的串行队列，见 save() 注释。 */
  private saveChain: Promise<void> = Promise.resolve();

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

  /**
   * 原子写：先写临时文件再 rename，避免崩溃留下半份快照。
   *
   * 写入串行化：低频刷新与手动刷新可能同时触发落盘，而临时文件路径
   * 只有一个，交叉写入会让 rename 撞上已被移走的 tmp 文件。
   * 快照在队列内序列化，保证最后一次调用写入的是最新状态。
   */
  save(): Promise<void> {
    const write = this.saveChain.then(async () => {
      const tmpPath = `${this.filePath}.tmp`;
      await this.fileIO.writeFile(
        tmpPath,
        JSON.stringify(this.toSnapshot(), null, 2),
      );
      await this.fileIO.renameFile(tmpPath, this.filePath);
    });
    // 失败只交给本次调用方，不阻塞后续写入。
    this.saveChain = write.catch(() => undefined);
    return write;
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

  getSource(id: string): CalendarSource | undefined {
    const source = this.sources.get(id);
    return source === undefined ? undefined : clone(source);
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

  /** 启用 / 停用来源（SRC-003）；停用后事件不进入 UI，但数据保留。 */
  setSourceEnabled(id: string, enabled: boolean): boolean {
    const source = this.sources.get(id);
    if (!source) {
      return false;
    }
    this.sources.set(id, { ...source, enabled });
    return true;
  }

  /**
   * 整体替换 WebCal 缓存元数据（SC-007 / SRC-004）。
   * 不做增量合并：服务端不再返回校验值时必须能清掉旧值，
   * 否则会用过期 ETag 发出条件请求而永远拿不到新内容。
   */
  setSourceCache(id: string, cache: WebcalCache): boolean {
    const source = this.sources.get(id);
    if (!source) {
      return false;
    }
    this.sources.set(id, { ...source, webcal: clone(cache) });
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

  /**
   * 用一批新事件替换某来源的事件（WebCal 全量刷新场景）。
   *
   * 按持久化键求差集，而不是“先清空再写入”：
   * - 批次中仍存在的事件保持原记录，增强结果不会因刷新被整体丢弃；
   * - 只有批次中消失的事件才被删除。
   */
  replaceSourceEvents(sourceId: string, events: StoredEvent[]): ReplaceResult {
    const nextKeys = new Set(
      events.map((event) => eventKey(identityOfEvent({ ...event, sourceId }))),
    );
    const prefix = eventKeyPrefix(sourceId);
    let removed = 0;
    for (const key of [...this.events.keys()]) {
      if (key.startsWith(prefix) && !nextKeys.has(key)) {
        this.events.delete(key);
        this.enrichments.delete(key);
        removed += 1;
      }
    }
    const { inserted, updated } = this.upsertEvents(sourceId, events);
    return { inserted, updated, removed };
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
   * 读取模型：原始事件 + 增强结果连接为 EnrichedEvent
   * （normalizedTitle 回退口径见 asNormalizedEvent）。
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
          ...asNormalizedEvent(clone(event)),
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
