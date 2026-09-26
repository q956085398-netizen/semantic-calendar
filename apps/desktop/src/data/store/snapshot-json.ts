/**
 * 快照 JSON 的分片序列化（SC-024）。
 *
 * 落盘原先走「`toSnapshot()` 逐条克隆 + 一次 `JSON.stringify`」：10,000 条事件
 * 下克隆约 43 ms、序列化约 15 ms（performance.md §3.5），两者都不中断主线程，
 * 而它们发生在一次导入的收尾——用户刚点完导入，界面正好在这时该恢复响应。
 *
 * 分片版本做两件事：
 * - **不再克隆**：快照是给磁盘的文本，落盘路径上没有“把快照交给别人”这一步，
 *   克隆纯属多余；序列化只读，而存储里每条记录都是整体替换、从不原地修改
 *   （事件、来源、增强、设置都如此），因此逐条读到的都是某条记录的一个完整版本。
 * - **逐条序列化**：每项用 `JSON.stringify(item, null, 2)` 单独成文，再按它所在的
 *   缩进层级补前缀拼成整份文本。因此没有一次调用要遍历全部数据。
 *
 * 输出与 `JSON.stringify(snapshot, null, 2)` **逐字节相同**：JSON 数组/对象的元素
 * 之间没有跨元素的序列化状态，缩进是相对的，所以逐项拼接与整体调用等价。
 * snapshot-json.test.ts 用富夹具逐字节对照这两条路径，格式变动会当场失败。
 *
 * **跨片期间发生的改动**：分区名单（来源、事件、增强的键）在开始时就取好，逐条读到
 * 的都是某条记录的一个完整版本（存储总是整体替换记录、从不原地修改），因此不会写出
 * 「半条记录」。与改动前的同步调用相比只有一点差别：这份快照不再对应某个单一瞬间，
 * 而是每条记录各自取一个时刻。改动自己的那次 `save()` 会把它写进磁盘（调用方约定：
 * 每次改动都跟一次落盘），因此磁盘上最终的状态仍是权威的。
 */

import type { CalendarSource, StoredEvent } from "../model";
import type { EventEnrichment } from "./schema";
import { isChunkBoundary } from "../../scheduling/chunk-boundary";

/**
 * 分片粒度（项数）：每项一次 `JSON.stringify` + 一次换行补缩进（约 4 µs/条，
 * 10,000 条约 40 ms 总量），128 项一片约 0.5 ms。
 */
export const SNAPSHOT_CHUNK_ITEMS = 128;

const INDENT = "  ";

/**
 * 序列化的输入：各分区已按稳定顺序排好（来源按 id、事件按持久化键），
 * 增强结果与设置按 Map 的键排序后输出。与 `StoreSnapshotV1` 的键顺序一致。
 */
export interface SnapshotSections {
  schemaVersion: number;
  sources: readonly CalendarSource[];
  events: readonly StoredEvent[];
  enrichments: ReadonlyMap<string, EventEnrichment>;
  settings: ReadonlyMap<string, unknown>;
}

/** 分片序列化整个快照；输出与 `JSON.stringify(snapshot, null, 2)` 逐字节相同。 */
export function* snapshotJsonInChunks(
  sections: SnapshotSections,
  chunkItems: number = SNAPSHOT_CHUNK_ITEMS,
): Generator<void, string, void> {
  const sources = yield* arrayInChunks(sections.sources, 1, chunkItems);
  const events = yield* arrayInChunks(sections.events, 1, chunkItems);
  const enrichments = yield* recordInChunks(
    sections.enrichments,
    1,
    chunkItems,
  );
  const settings = yield* recordInChunks(sections.settings, 1, chunkItems);

  return [
    "{",
    `\n${INDENT}"schemaVersion": ${JSON.stringify(sections.schemaVersion)},`,
    `\n${INDENT}"sources": ${sources},`,
    `\n${INDENT}"events": ${events},`,
    `\n${INDENT}"enrichments": ${enrichments},`,
    `\n${INDENT}"settings": ${settings}`,
    "\n}",
  ].join("");
}

/** 数组文本；depth 是持有它的那个键的缩进层级（顶层键为 1）。 */
function* arrayInChunks(
  items: readonly unknown[],
  depth: number,
  chunkItems: number,
): Generator<void, string, void> {
  if (items.length === 0) {
    return "[]";
  }
  const itemIndent = INDENT.repeat(depth + 1);
  const parts: string[] = ["[\n"];
  for (let index = 0; index < items.length; index += 1) {
    if (isChunkBoundary(index, chunkItems)) {
      yield;
    }
    // JSON.stringify 对 undefined 的数组项输出 null，这里照抄同一结果。
    const text = JSON.stringify(items[index], null, 2) ?? "null";
    parts.push(
      itemIndent,
      reindent(text, depth + 1),
      index + 1 < items.length ? ",\n" : "\n",
    );
  }
  parts.push(INDENT.repeat(depth), "]");
  return parts.join("");
}

/** 对象文本（键按字典序）；值为 undefined 的键与 JSON.stringify 一致地不输出。 */
function* recordInChunks(
  entries: ReadonlyMap<string, unknown>,
  depth: number,
  chunkItems: number,
): Generator<void, string, void> {
  const keys = [...entries.keys()].sort(compareString);
  const itemIndent = INDENT.repeat(depth + 1);
  const parts: string[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    if (isChunkBoundary(index, chunkItems)) {
      yield;
    }
    const text = JSON.stringify(entries.get(keys[index]), null, 2);
    if (text === undefined) {
      continue;
    }
    parts.push(
      `${parts.length === 0 ? "" : ",\n"}${itemIndent}${JSON.stringify(
        keys[index],
      )}: ${reindent(text, depth + 1)}`,
    );
  }
  return parts.length === 0
    ? "{}"
    : `{\n${parts.join("")}\n${INDENT.repeat(depth)}}`;
}

/**
 * 把一段独立序列化出来的 JSON 补到目标缩进层级：首行由调用方定位，
 * 其余各行按层级加前缀（JSON 的缩进是相对的，这正是逐项拼接等于整体调用的原因）。
 */
function reindent(text: string, depth: number): string {
  const pad = INDENT.repeat(depth);
  return text.split("\n").join(`\n${pad}`);
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
