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
import { isChunkBoundary } from "../../scheduling/chunk-boundary";
import { drain, NO_SLICES } from "../../scheduling/drain";
import {
  runYielding,
  type RunYieldingDeps,
} from "../../scheduling/run-yielding";
import {
  CURRENT_SCHEMA_VERSION,
  isValidSnapshotShape,
  narrowStoredEvent,
  narrowStoredSource,
  type EventEnrichment,
  type StoreSnapshotV1,
} from "./schema";
import { snapshotJsonInChunks, type SnapshotSections } from "./snapshot-json";
import type { FileIO } from "./file-io";

/**
 * 分片粒度（事件条数）：落库每条只算一次键并写一次 Map（远便宜于解析），
 * 128 条一片约 0.1 ms；读取模型的逐条克隆（约 4 µs/条）也用同一粒度。
 */
export const STORE_CHUNK_EVENTS = 128;

/** 落盘的注入点：只供测试加速分片（见 save）。 */
export type StoreSaveDeps = RunYieldingDeps;

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
   *
   * 序列化分片进行（SC-024）：10,000 条事件下逐条克隆 + 一次 stringify 共约
   * 60 ms 不中断，而落盘正好发生在一件用户动作的收尾（导入完成后界面就该恢复
   * 响应）。分片后每个任务约 5 ms，`writeFile` 本身是异步 I/O。
   */
  save(deps: StoreSaveDeps = {}): Promise<void> {
    const write = this.saveChain.then(async () => {
      const tmpPath = `${this.filePath}.tmp`;
      await this.fileIO.writeFile(tmpPath, await this.serializeSnapshot(deps));
      await this.fileIO.renameFile(tmpPath, this.filePath);
    });
    // 失败只交给本次调用方，不阻塞后续写入。
    this.saveChain = write.catch(() => undefined);
    return write;
  }

  /** 分片序列化当前状态；输出与 `JSON.stringify(toSnapshot(), null, 2)` 逐字节相同。 */
  async serializeSnapshot(deps: StoreSaveDeps = {}): Promise<string> {
    return runYielding(this.snapshotJsonInChunks(), deps);
  }

  /**
   * 分片序列化生成器（SC-024）：`save()` 用它，性能基线也用它量「单次任务」
   * （主线程上最长的一段），见 src/bench/import-slices.bench.ts。
   */
  snapshotJsonInChunks(chunkItems?: number): Generator<void, string, void> {
    return snapshotJsonInChunks(this.snapshotSections(), chunkItems);
  }

  /**
   * 序列化输入：各分区按稳定顺序排好，**不克隆**——快照是给磁盘的文本，落盘
   * 路径上没有“把快照交出去”这一步；存储里每条记录都是整体替换、从不原地修改，
   * 因此逐条读到的都是某条记录的一个完整版本（见 snapshot-json.ts）。
   */
  private snapshotSections(): SnapshotSections {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      sources: [...this.sources.values()].sort(byId),
      events: [...this.events.entries()]
        .sort(([a], [b]) => compareString(a, b))
        .map(([, event]) => event),
      enrichments: this.enrichments,
      settings: this.settings,
    };
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

  /** 只改显示名称；身份、事件、同步状态及缓存保持不变。 */
  renameSource(id: string, name: string): boolean {
    const source = this.sources.get(id);
    const trimmed = name.trim();
    if (!source || trimmed === "") return false;
    this.sources.set(id, { ...source, name: trimmed });
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

  /**
   * 同步入口：**不切片**（chunkEvents = 0，一次算完），因此与改动前完全一致——
   * 含版本号只推进一次。切片与否是调用方声明的（见 upsertEventsInChunks），
   * 不是「生成器有没有 yield 过」推出来的。
   */
  upsertEvents(sourceId: string, events: StoredEvent[]): UpsertResult {
    return drain(this.upsertEventsInChunks(sourceId, events, NO_SLICES));
  }

  /**
   * 分片落库（SC-024 / app-spec §15）：每 chunkEvents 条给一个让出点，结果与
   * 同步入口逐条相同（`upsertEvents` 就是这个生成器在 chunkEvents = 0 下的一次排空）。
   *
   * **切片时版本号推进两次**（开始一次、结束一次），这是与同步入口唯一的可观察
   * 差异，也是必须的：分片让出主线程后，读取方（App 的 refreshFromStore）可能在
   * 落库进行到一半时读到事件集合，并把当时的版本号记成“已读过”。若结束时的版本号
   * 与半途读到的一样，读取方会认为集合没变、跳过重读——界面就永远停在半份事件上。
   *
   * 两次推进的判据是**调用方的分片粒度**而不是「生成器有没有 yield 过」：一次
   * 同步排空同样会经过让出点（只是立刻恢复），那样判会把「没有读取方可能插进来」
   * 的同步入口也变成推两次。粒度非正 = 不切片 = 一个任务里算完，读取方不可能
   * 读到半份，推一次就够。
   */
  *upsertEventsInChunks(
    sourceId: string,
    events: StoredEvent[],
    chunkEvents: number = STORE_CHUNK_EVENTS,
  ): Generator<void, UpsertResult, void> {
    const sliced = chunkEvents > 0;
    if (events.length > 0) {
      this.eventsRevisionValue += 1;
    }
    let inserted = 0;
    let updated = 0;
    for (let index = 0; index < events.length; index += 1) {
      if (isChunkBoundary(index, chunkEvents)) {
        yield;
      }
      const stamped = { ...events[index], sourceId };
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
    if (sliced && events.length > 0) {
      this.eventsRevisionValue += 1;
    }
    return { inserted, updated };
  }

  listEvents(sourceId?: string): StoredEvent[] {
    return drain(this.listEventsInChunks(sourceId, NO_SLICES));
  }

  /**
   * 分片读取原始事件（SC-024）：逐条克隆是这里唯一的代价（约 4 µs/条，
   * 10,000 条约 43 ms），选中与排序先做（都很便宜）。同步入口 `listEvents`
   * 是这个生成器的一次排空，结果逐条相同。
   *
   * 语义增强的重建用它取输入：那一段曾经把 43 ms 的整份克隆放在第一个任务里
   * （SC-020 只分了匹配循环），导入动作因此仍有一次跨帧的停顿。
   */
  *listEventsInChunks(
    sourceId?: string,
    chunkEvents: number = STORE_CHUNK_EVENTS,
  ): Generator<void, StoredEvent[], void> {
    const selected = [...this.events.values()].filter(
      (event) => sourceId === undefined || event.sourceId === sourceId,
    );
    const events: StoredEvent[] = [];
    for (let index = 0; index < selected.length; index += 1) {
      if (isChunkBoundary(index, chunkEvents)) {
        yield;
      }
      events.push(clone(selected[index]));
    }
    return events;
  }

  /**
   * 某来源是否已有事件（不带克隆）。用于「空响应是否要保留缓存」这类
   * 只关心有无的判定——`listEvents()` 会逐条克隆，10,000 条就是 43 ms。
   */
  hasEvents(sourceId: string): boolean {
    const prefix = eventKeyPrefix(sourceId);
    for (const key of this.events.keys()) {
      if (key.startsWith(prefix)) {
        return true;
      }
    }
    return false;
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
    return drain(this.replaceSourceEventsInChunks(sourceId, events, NO_SLICES));
  }

  /**
   * 分片全量替换（SC-024）：键集合构造、消失事件删除、新事件落库三段各自分片，
   * 同步入口 `replaceSourceEvents` 是这个生成器的一次排空，结果逐条相同。
   *
   * 版本号推进只有一处与同步入口不同：落库那一段由 `upsertEventsInChunks`
   * 负责（见那里的说明，分片期间它在开始与结束各推一次）。删除段的推进口径
   * 不变——删除全部发生在推进之前，中途读到旧版本号的读取方在结束时一定会
   * 看到一个更大的值，因此不会误判“集合没变”。
   */
  *replaceSourceEventsInChunks(
    sourceId: string,
    events: StoredEvent[],
    chunkEvents: number = STORE_CHUNK_EVENTS,
  ): Generator<void, ReplaceResult, void> {
    const nextKeys = new Set<string>();
    for (let index = 0; index < events.length; index += 1) {
      if (isChunkBoundary(index, chunkEvents)) {
        yield;
      }
      nextKeys.add(eventKey(identityOfEvent({ ...events[index], sourceId })));
    }
    const prefix = eventKeyPrefix(sourceId);
    // 键快照先取好：删除会改动 Map，但不能改动这次要比对的名单。
    const existingKeys = [...this.events.keys()];
    let removed = 0;
    for (let index = 0; index < existingKeys.length; index += 1) {
      if (isChunkBoundary(index, chunkEvents)) {
        yield;
      }
      const key = existingKeys[index];
      if (key.startsWith(prefix) && !nextKeys.has(key)) {
        this.events.delete(key);
        this.enrichments.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.eventsRevisionValue += 1;
    }
    const { inserted, updated } = yield* this.upsertEventsInChunks(
      sourceId,
      events,
      chunkEvents,
    );
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
    return drain(this.listEnrichedEventsInChunks(sourceId, NO_SLICES));
  }

  /**
   * 分片读取模型（SC-024 / app-spec §15）：选中与排序（10,000 条约 3 ms）同步
   * 完成，逐条克隆与增强连接（约 4 µs/条，占总代价的九成）分片进行。同步入口
   * `listEnrichedEvents` 是这个生成器的一次排空，结果逐条相同。
   *
   * 只在算完后发布整份结果：读取方拿它换掉界面上的一整份事件集合，半份结果会
   * 让月格与详情栏在几帧内反复变化（与月视图展开同一取舍）。
   */
  *listEnrichedEventsInChunks(
    sourceId?: string,
    chunkEvents: number = STORE_CHUNK_EVENTS,
  ): Generator<void, EnrichedEvent[], void> {
    const selected = [...this.events.values()]
      .filter((event) => sourceId === undefined || event.sourceId === sourceId)
      .sort(
        (a, b) =>
          compareString(a.start, b.start) || compareString(a.uid, b.uid),
      );
    const enriched: EnrichedEvent[] = [];
    for (let index = 0; index < selected.length; index += 1) {
      if (isChunkBoundary(index, chunkEvents)) {
        yield;
      }
      const event = selected[index];
      const enrichment = this.enrichments.get(eventKey(identityOfEvent(event)));
      enriched.push({
        ...asNormalizedEvent(clone(event)),
        semantic: enrichment?.semantic,
        metadata: enrichment?.metadata,
      });
    }
    return enriched;
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
