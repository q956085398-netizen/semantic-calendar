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
 * - **同步入口**就是分片生成器的一次排空，两者结果逐条相同。
 */

import type { EnrichedEvent } from "../model";
import type { CalendarStore } from "./calendar-store";

export interface EnrichedEventsLoadInput {
  store: CalendarStore;
  /** 参与界面的来源：停用来源的事件不进结果（SRC-003）。 */
  enabledSourceIds: ReadonlySet<string>;
  /** 分片粒度（事件条数）；缺省用存储的读取粒度，只供测试注入更小的值。 */
  chunkEvents?: number;
}

/** 同步入口：一次排空（测试与短列表用，生产路径走分片入口）。 */
export function loadEnrichedEvents(
  input: EnrichedEventsLoadInput,
): EnrichedEvent[] {
  const steps = enrichedEventsInChunks(input);
  let step = steps.next();
  while (!step.done) {
    step = steps.next();
  }
  return step.value;
}

/**
 * 分片读取：先按存储顺序逐条克隆并连接增强结果（分片），再按启用集合过滤。
 * 调用方用 `runYielding` 把它跑完，任务之间让出主线程。
 */
export function* enrichedEventsInChunks(
  input: EnrichedEventsLoadInput,
): Generator<void, EnrichedEvent[], void> {
  const events = yield* input.store.listEnrichedEventsInChunks(
    undefined,
    input.chunkEvents,
  );
  return events.filter((event) => input.enabledSourceIds.has(event.sourceId));
}
