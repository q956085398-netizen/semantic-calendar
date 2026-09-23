/**
 * 核心数据模型（app-spec.md §8）。
 *
 * 语义边界：
 * - RawCalendarEvent 只保存来源给定的原始事实，不做任何标准化；
 * - NormalizedEvent 是标准化的超集，标准化规则由 SC-008 提供；
 * - SemanticEvent 只描述“这是什么”，不描述“怎么显示”；
 * - 增强结果与原始事件分开存储，Matcher 更新后可重建。
 */

export type CalendarSourceType =
  "local-ics" | "webcal" | "builtin" | "provider";

export type SourceSyncStatus = "ok" | "error" | "never";

export interface CalendarSource {
  id: string;
  type: CalendarSourceType;
  name: string;
  enabled: boolean;
  color?: string;
  lastSyncAt?: string;
  lastSyncStatus?: SourceSyncStatus;
  lastSyncError?: string;
}

/**
 * EXDATE 原值与其参数；与生成实例的比较空间由 Normalizer 决定
 * （值形态：8 位纯日期 / 墙钟时间 / Z 结尾 UTC）。
 */
export interface ExdateValue {
  /** 原始 ICS 值：YYYYMMDD / YYYYMMDDTHHMMSS / YYYYMMDDTHHMMSSZ。 */
  value: string;
  /** EXDATE;TZID=… 的 IANA 时区名。 */
  tzid?: string;
}

/** 原始重复规则：只保留原文事实，解释与展开属 Normalizer（SC-008）。 */
export interface RawRecurrence {
  rrule?: string;
  exdates: ExdateValue[];
}

export interface RawCalendarEvent {
  uid: string;
  sourceId: string;
  title: string;
  description?: string;
  location?: string;
  /** ISO 8601 字符串。全天事件为当日零点日期，时区语义由 SC-008 统一。 */
  start: string;
  end?: string;
  allDay: boolean;
  /**
   * DTSTART / DTEND 的 TZID 参数原文（IANA 时区名）。
   * 浮动时间、UTC、全天事件无此字段；墙钟 → UTC 的精确换算属 SC-008。
   */
  startTzid?: string;
  endTzid?: string;
  /**
   * RECURRENCE-ID 标识的具体实例。属于持久化身份（ICS-001），
   * 因此在原始事件上而非仅标准化事件上保存。
   */
  occurrenceId?: string;
  /** STATUS:CANCELLED；v0.1 仅用于重复规则例外实例的取消语义。 */
  cancelled?: boolean;
  /** 原始重复规则（RRULE / EXDATE 等）。 */
  recurrence?: RawRecurrence;
  /** 原始 ICS 事件片段，保证原始字段可追溯。 */
  rawPayload?: string;
}

export interface NormalizedEvent extends RawCalendarEvent {
  normalizedTitle: string;
  timezone?: string;
}

/** 入库事件：以原始事件为下限，允许无损携带标准化超集字段。 */
export type StoredEvent = RawCalendarEvent &
  Partial<Pick<NormalizedEvent, "normalizedTitle" | "timezone">>;

export type SemanticEventType =
  | "calendar.event"
  | "holiday"
  | "makeup-workday"
  | "festival"
  | "solar-term"
  | "sport.fixture";

export interface SemanticEntity {
  type: string;
  id: string;
}

export interface SemanticEvent {
  type: SemanticEventType;
  subtype?: string;
  entities?: SemanticEntity[];
  confidence?: number;
  matcherId?: string;
}

export interface EnrichedEvent extends NormalizedEvent {
  semantic?: SemanticEvent;
  metadata?: Record<string, unknown>;
}

/** 事件的持久化身份：同一来源内按 UID / recurrence identity 去重（ICS-001）。 */
export interface EventIdentity {
  sourceId: string;
  uid: string;
  occurrenceId?: string;
}

/**
 * ICS 字段不会包含 NUL 字符，因此用它拼接持久化键不会与真实数据冲突；
 * 通过 fromCharCode 产生，保证源文件本身是纯文本。
 */
const EVENT_KEY_SEPARATOR = String.fromCharCode(0);

export function eventKey(identity: EventIdentity): string {
  return [identity.sourceId, identity.uid, identity.occurrenceId ?? ""].join(
    EVENT_KEY_SEPARATOR,
  );
}

/** 某来源全部事件键的公共前缀，供级联删除按来源过滤。 */
export function eventKeyPrefix(sourceId: string): string {
  return sourceId + EVENT_KEY_SEPARATOR;
}

export function identityOfEvent(event: RawCalendarEvent): EventIdentity {
  return {
    sourceId: event.sourceId,
    uid: event.uid,
    occurrenceId: event.occurrenceId,
  };
}
