import type {
  CalendarSource,
  CalendarSourceType,
  EventAlarm,
  RawRecurrence,
  SemanticEvent,
  SourceSyncStatus,
  StoredEvent,
  WebcalCache,
} from "../model";

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

/**
 * 单条存储事件的读取边界（SC-019 / app-spec §13「单个坏事件被隔离」）。
 *
 * 快照是本地 JSON 文件：可能被手工编辑、被同步工具改坏，或被旧版本写过。
 * 结构级校验只看到“events 是数组”，一条缺字段的记录照样会进内存，
 * 然后在月格展开时把整个日历打掉——一条坏日程不该毁掉整个应用。
 *
 * 收窄分两层，粒度不同：
 * - 必需字段（uid / sourceId / title / start / allDay）不合格 → 丢弃整个事件；
 * - 可选字段类型不对 → 只丢该字段，事件照常显示（坏字段不该吃掉整条日程）。
 * `start` / `end` 只要求形如 YYYY-MM-DD：这是日期键、分桶与比较的最小前提，
 * 更细的时间语义由 SC-008 的规范化负责。
 */
export function narrowStoredEvent(value: unknown): StoredEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const { uid, sourceId, title, start, allDay } = value;
  if (!isNonEmptyString(uid) || !isNonEmptyString(sourceId)) {
    return null;
  }
  if (typeof title !== "string" || typeof allDay !== "boolean") {
    return null;
  }
  if (!isDateLike(start)) {
    return null;
  }

  const event: StoredEvent = { uid, sourceId, title, start, allDay };
  // end 与 start 同类：同样只接受日期形态（拒掉 “明天” 这类非时间值）。
  if (isDateLike(value.end)) {
    event.end = value.end;
  }
  // 其余可选字段只需是字符串：内容语义由 SC-008 负责，这里只挡类型错误。
  for (const field of [
    "description",
    "location",
    "normalizedTitle",
    "startTzid",
    "endTzid",
    "occurrenceId",
    "timezone",
    "rawPayload",
  ] as const) {
    const fieldValue = value[field];
    if (typeof fieldValue === "string") {
      event[field] = fieldValue;
    }
  }
  if (typeof value.cancelled === "boolean") {
    event.cancelled = value.cancelled;
  }

  const recurrence = narrowRecurrence(value.recurrence);
  if (recurrence !== null) {
    event.recurrence = recurrence;
  }
  const alarms = narrowAlarms(value.alarms);
  if (alarms.length > 0) {
    event.alarms = alarms;
  }
  return event;
}

/** 重复规则：逐条 EXDATE 收窄，坏条目丢弃；没有可用内容时整块丢弃。 */
function narrowRecurrence(value: unknown): RawRecurrence | null {
  if (!isRecord(value)) {
    return null;
  }
  const exdates: RawRecurrence["exdates"] = [];
  if (Array.isArray(value.exdates)) {
    for (const entry of value.exdates) {
      if (!isRecord(entry) || !isNonEmptyString(entry.value)) {
        continue;
      }
      exdates.push(
        isNonEmptyString(entry.tzid)
          ? { value: entry.value, tzid: entry.tzid }
          : { value: entry.value },
      );
    }
  }
  const rrule = value.rrule;
  if (isNonEmptyString(rrule)) {
    return { rrule, exdates };
  }
  // 只有 EXDATE 没有规则时仍要保留：它是取消实例的依据。
  return exdates.length > 0 ? { exdates } : null;
}

/** 事件自带提醒：字段取值必须落在模型定义的枚举里，其余整条丢弃。 */
function narrowAlarms(value: unknown): EventAlarm[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const alarms: EventAlarm[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const { minutes, direction, related } = entry;
    if (
      typeof minutes !== "number" ||
      !Number.isFinite(minutes) ||
      minutes < 0
    ) {
      continue;
    }
    if (direction !== "before" && direction !== "after") {
      continue;
    }
    if (related !== "start" && related !== "end") {
      continue;
    }
    alarms.push({ minutes, direction, related });
  }
  return alarms;
}

/** 日期形态：至少 YYYY-MM-DD，时间部分可选（全天 vs 定时由 allDay 决定）。 */
function isDateLike(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value);
}

/**
 * 单个来源的读取边界（SC-019）：与事件同理——id 缺失或类型不对的记录
 * 会在侧栏渲染时就地炸掉（识别色按 id 派生），一条坏来源不该让侧栏消失。
 * 名字为空串仍可用（只是显示成空行），因此只要求它是字符串。
 * 无法读取的来源整条丢弃；它的事件保留（不删用户数据），只是暂时不可达。
 */
export function narrowStoredSource(value: unknown): CalendarSource | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, name, type, enabled } = value;
  if (!isNonEmptyString(id) || typeof name !== "string") {
    return null;
  }
  if (!isSourceType(type) || typeof enabled !== "boolean") {
    return null;
  }

  const source: CalendarSource = { id, type, name, enabled };
  for (const field of ["color", "lastSyncAt", "lastSyncError"] as const) {
    const fieldValue = value[field];
    if (typeof fieldValue === "string") {
      source[field] = fieldValue;
    }
  }
  if (isSyncStatus(value.lastSyncStatus)) {
    source.lastSyncStatus = value.lastSyncStatus;
  }
  const webcal = narrowWebcalCache(value.webcal);
  if (webcal !== null) {
    source.webcal = webcal;
  } else if (type === "webcal") {
    // 订阅的地址就是它本身（id 由地址派生）：没有可用地址的订阅既不能刷新
    // 也不能解释，留着只会变成一行永远失败、又不能修正的来源。整条丢弃。
    return null;
  }
  return source;
}

function isSourceType(value: unknown): value is CalendarSourceType {
  return (
    value === "local-ics" ||
    value === "webcal" ||
    value === "builtin" ||
    value === "provider"
  );
}

function isSyncStatus(value: unknown): value is SourceSyncStatus {
  return value === "ok" || value === "error" || value === "never";
}

/** 订阅缓存：地址是抓取的唯一依据，缺了就没有可用的来源（整块丢弃）。 */
function narrowWebcalCache(value: unknown): WebcalCache | null {
  if (!isRecord(value) || !isNonEmptyString(value.url)) {
    return null;
  }
  const cache: WebcalCache = { url: value.url };
  for (const field of ["etag", "lastModified", "lastCheckedAt"] as const) {
    const fieldValue = value[field];
    if (typeof fieldValue === "string") {
      cache[field] = fieldValue;
    }
  }
  return cache;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
