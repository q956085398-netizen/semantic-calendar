/**
 * 入库标准化（SC-008 / app-spec §7.3 + §11）。
 *
 * 原始事件原样保留，只附加可由原始字段重建的标准化结果：
 * - normalizedTitle：Unicode / 空白清洗后的标题（Matcher 的输入）；
 * - timezone：事件时区语义（IANA 名 / UTC；浮动与全天缺省）。
 * TZID → UTC 的瞬时换算不落库：occurrence 展开在读取路径计算
 * （SEM-004：规则更新后无需重新导入即可修正结果）。
 * 标准化字段总是从原始字段重算，重复执行幂等。
 */

import type { RawCalendarEvent, StoredEvent } from "../data/model";
import { isChunkBoundary } from "../scheduling/chunk-boundary";
import { normalizeEventTitle } from "./title";

export function normalizeEventForStorage(event: RawCalendarEvent): StoredEvent {
  const timezone = resolveTimezone(event);
  return {
    ...event,
    normalizedTitle: normalizeEventTitle(event.title),
    ...(timezone !== undefined && { timezone }),
  };
}

/**
 * 分片粒度（事件条数）：每条约 1.5 µs（10,000 条约 15 ms，performance.md
 * §3.5），128 条一片约 0.2 ms。导入与订阅刷新两条摄入链路的标准化与落库
 * 都用这个粒度（两条都是逐条遍历，每条代价同量级）。
 */
export const NORMALIZE_CHUNK_EVENTS = 128;

/**
 * 同步入口：分片生成器的一次排空，结果逐条相同（normalizer.test.ts 有
 * 等价性用例）。解析产物按调用方声明的来源落成入库事件。
 */
export function normalizeEventsForStorage(
  events: readonly Omit<RawCalendarEvent, "sourceId">[],
  sourceId: string,
): StoredEvent[] {
  const steps = normalizeEventsInChunks(events, sourceId);
  let step = steps.next();
  while (!step.done) {
    step = steps.next();
  }
  return step.value;
}

/**
 * 分片标准化（SC-024 / app-spec §15「大量事件不应阻塞 UI 线程」）。
 *
 * 这一趟很容易被漏掉：解析与落库各自分片之后，中间这条一次 15 ms 的同步
 * 遍历正好是一帧，10,000 条导入里它自己就是一次可感知的停顿。
 */
export function* normalizeEventsInChunks(
  events: readonly Omit<RawCalendarEvent, "sourceId">[],
  sourceId: string,
  chunkEvents: number = NORMALIZE_CHUNK_EVENTS,
): Generator<void, StoredEvent[], void> {
  const stored: StoredEvent[] = [];
  for (let index = 0; index < events.length; index += 1) {
    if (isChunkBoundary(index, chunkEvents)) {
      yield;
    }
    // sourceId 以调用方声明为准，与 CalendarStore.upsertEvents 同一口径。
    stored.push(normalizeEventForStorage({ ...events[index], sourceId }));
  }
  return stored;
}

/** 时区语义：TZID > UTC > 浮动（缺省）；全天事件无时区语义。 */
function resolveTimezone(event: RawCalendarEvent): string | undefined {
  if (event.allDay) {
    return undefined;
  }
  if (event.startTzid !== undefined) {
    return event.startTzid;
  }
  return event.start.endsWith("Z") ? "UTC" : undefined;
}
