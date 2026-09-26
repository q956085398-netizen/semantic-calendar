/**
 * 事件集合的分片读取（SC-024）：界面拿到的「当前可见事件」。
 *
 * 读取模型 `CalendarStore.listEnrichedEvents` 会逐条克隆（10,000 条约 37 ms，
 * 占总代价的九成以上），而它刚好发生在每次导入 / 刷新 / 启动的收尾——正好是
 * 界面该恢复响应的时候。这里把这条读取拆成短任务：
 *
 * - **结果整份发布**：生成器排空（`runYielding`）之后调用方才拿得到结果，
 *   在那之前界面继续显示上一份集合。半份结果会让月格、详情栏与提醒计划在
 *   几帧内反复变化，比晚几帧更难解释；
 * - **停用来源不进结果**（SRC-003）：过滤在克隆之后做（与改动前同一顺序），
 *   过滤本身是常数开销（10,000 条约 0.3 ms）；
 * - **同步入口不切片**（`NO_SLICES`）或分片生成器的一次排空，两者结果逐条相同。
 */

import type { EnrichedEvent } from "../model";
import { drain, NO_SLICES } from "../../scheduling/drain";
import type { CalendarStore } from "./calendar-store";

export interface EnrichedEventsLoadInput {
  store: CalendarStore;
  /** 参与界面的来源：停用来源的事件不进结果（SRC-003）。 */
  enabledSourceIds: ReadonlySet<string>;
}

/** 同步入口：不切片，一次算完（测试与短列表用，生产路径走分片入口）。 */
export function loadEnrichedEvents(
  input: EnrichedEventsLoadInput,
): EnrichedEvent[] {
  return drain(enrichedEventsInChunks(input, NO_SLICES));
}

/**
 * 分片读取：先按存储顺序逐条克隆并连接增强结果（分片），再按启用集合过滤。
 * 调用方用 `runYielding` 把它跑完，任务之间让出主线程；粒度的默认值来自存储的
 * 读取粒度（`STORE_CHUNK_EVENTS`）。
 */
export function* enrichedEventsInChunks(
  input: EnrichedEventsLoadInput,
  chunkEvents?: number,
): Generator<void, EnrichedEvent[], void> {
  const events = yield* input.store.listEnrichedEventsInChunks(
    undefined,
    chunkEvents,
  );
  return events.filter((event) => input.enabledSourceIds.has(event.sourceId));
}
