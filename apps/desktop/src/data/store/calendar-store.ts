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
  narrowStoredEvent,
  narrowStoredSource,
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
  /**
   * 读取时被隔离的坏记录（SC-019）：既不进内存，也不影响其余记录。
   * 调用方据此说明“少了几条”，而不是静默丢掉用户数据。
   */
  dropped?: DroppedRecords;
}

/** 快照读取时被隔离的记录数；两者都为 0 时不出现在结果里。 */
export interface DroppedRecords {
  /** 无法读取、已被隔离的事件数。 */
  events: number;
  /** 无法读取、已被隔离的来源数（其事件保留，只是暂时不可达）。 */
  sources: number;
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
  /** 可见事件集合的版本号，见 eventsRevision()。 */
  private eventsRevisionValue = 0;

  private constructor(
    private readonly fileIO: FileIO,
    readonly filePath: string,
  ) {}

  get schemaVersion(): number {
    return CURRENT_SCHEMA_VERSION;
  }

  /**
   * 可见事件集合的版本号：**只在集合真的会变时推进**（事件的增删改、来源启停、
   * 来源删除），来源状态 / 校验值这类不动事件的改动不推进。
   *
   * 读取方（App）用它决定要不要重新读取事件。快照里的事件是逐条克隆出来的
   * （10,000 条约 37 ms，performance.md §2.1），而 304 刷新与失败刷新都不会
   * 改变事件集合——没有这个信号，读取方只能靠“事件数组换了新对象”判断，
   * 于是每次后台刷新都白读一遍、白算一遍月格（SC-020）。
   *
   * 版本号是实例内的单调计数，不落盘：它的用途只是“与上一次读到的比一比”，
   * 因此新实例从 0 开始，与任何旧值都不相等，读取方会保守地重读一次。
   */
  eventsRevision(): number {
    return this.eventsRevisionValue;
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
    const { dropped, rejected } = store.loadSnapshot(migrated);
    if (dropped !== undefined) {
      // 坏记录另存一份再丢弃：与整份快照损坏时隔离原文件同一口径——
      // 数据留在磁盘上供人工检查，而不是被下一次落盘悄悄抹掉（SC-019）。
      await quarantineRejectedRecords(fileIO, filePath, rejected);
      return { store, dropped };
    }
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
    if (source.enabled !== enabled) {
      // 可见集合变了：停用 / 启用会改变哪些事件进入界面（SRC-003）。
      this.eventsRevisionValue += 1;
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
    if (events.length > 0) {
      this.eventsRevisionValue += 1;
    }
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
    let removed = 0;
    for (const key of [...this.events.keys()]) {
      if (key.startsWith(prefix)) {
        this.events.delete(key);
        this.enrichments.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.eventsRevisionValue += 1;
    }
  }

  /**
   * 用一批新事件替换某来源的事件（WebCal 全量刷新场景）。
   *
   * 按持久化键求差集，而不是“先清空再写入”：
   * - 批次里仍存在的事件保持同一个持久化键（来源 / UID / occurrence 身份
   *   不因刷新变化），因此刷新不产生副本；
   * - 只有批次中消失的事件才被删除，连同它的增强记录。
   *
   * 增强结果不在这一层区分“内容是否真的变了”：重新入库的记录一律按旧结果
   * 失效处理（见 `upsertEvents`），由刷新后的重建恢复（SC-007 → SEM-004）。
   * 匹配是确定性的，因此重建结果与刷新前一致，用户不会因为一次刷新丢语义。
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
    if (removed > 0) {
      this.eventsRevisionValue += 1;
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
    const quarantinedTo = `${filePath}.corrupt-${quarantineSuffix()}`;
    await fileIO.renameFile(filePath, quarantinedTo);
    return {
      store: new CalendarStore(fileIO, filePath),
      recovery: { reason, quarantinedTo },
    };
  }

  /**
   * 载入快照；返回被隔离的坏记录与它们的原文（SC-019：坏记录不进内存）。
   * 全部合法时 `dropped` 为 undefined，调用方不必判断“0 条被丢弃”。
   */
  private loadSnapshot(data: Record<string, unknown>): {
    dropped?: DroppedRecords;
    rejected: unknown[];
  } {
    if (!isValidSnapshotShape(data)) {
      throw new Error("快照形态未通过校验，不应到达此处");
    }
    const snapshot = data as unknown as StoreSnapshotV1;
    const rejected: unknown[] = [];
    let droppedSources = 0;
    for (const source of snapshot.sources) {
      // 逐条收窄：不可读取的记录被隔离在这里，后面的侧栏渲染不会遇到它。
      const narrowed = narrowStoredSource(source);
      if (narrowed === null) {
        rejected.push(source);
        droppedSources += 1;
        continue;
      }
      this.sources.set(narrowed.id, narrowed);
    }
    let droppedEvents = 0;
    for (const event of snapshot.events) {
      // 事件同理：月格展开拿到的一定是字段齐全的记录。
      const narrowed = narrowStoredEvent(event);
      if (narrowed === null) {
        rejected.push(event);
        droppedEvents += 1;
        continue;
      }
      this.events.set(eventKey(identityOfEvent(narrowed)), narrowed);
    }
    for (const [key, enrichment] of Object.entries(snapshot.enrichments)) {
      this.enrichments.set(key, enrichment);
    }
    for (const [key, value] of Object.entries(snapshot.settings)) {
      this.settings.set(key, value);
    }
    return droppedSources === 0 && droppedEvents === 0
      ? { rejected }
      : {
          dropped: { events: droppedEvents, sources: droppedSources },
          rejected,
        };
  }
}

/**
 * 被隔离记录的另存文件（SC-019）：与整份快照损坏时的 `.corrupt-` 同一形状，
 * 文件名只含字母数字与连字符（Rust 侧的白名单校验）。
 *
 * 写失败不阻断启动——那时原文仍在主文件里，直到下一次落盘为止；
 * 界面只报告条数，不承诺“已备份”（写没写成不是界面能断言的事）。
 */
async function quarantineRejectedRecords(
  fileIO: FileIO,
  filePath: string,
  records: readonly unknown[],
): Promise<void> {
  const target = `${filePath}.rejected-${quarantineSuffix()}`;
  try {
    await fileIO.writeFile(
      target,
      JSON.stringify(
        { rejectedAt: new Date().toISOString(), records },
        null,
        2,
      ),
    );
  } catch {
    // 见上：启动不因为备份失败而失败。
  }
}

/** 隔离文件的时间戳后缀：ISO 里的分隔符换成连字符，便于做文件名。 */
function quarantineSuffix(): string {
  return new Date().toISOString().replace(/[^0-9A-Za-z]+/g, "-");
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
