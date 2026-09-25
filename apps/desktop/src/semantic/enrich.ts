import { asNormalizedEvent, identityOfEvent } from "../data/model";
import type { CalendarStore } from "../data/store/calendar-store";
import { yieldToMain as defaultYieldToMain } from "../scheduling/yield-to-main";
import type { MatcherEngine } from "./matcher-engine";
import type { MetadataResolverStack } from "./metadata-resolver";

/**
 * 语义增强管线（SC-009，app-spec §7 主链路的 Matcher → Semantic →
 * Metadata 段）。
 *
 * - 只写增强分区（enrichments），原始事件分区分毫不动（验收：
 *   “原始数据不被覆盖”）；
 * - 未命中不写记录，读取侧自动按普通事件显示（SEM-003）；
 * - 重建入口唯一（`reEnrichStore` / `reEnrichStoreYielding` 共用同一份
 *   分片实现）：Matcher 更新后换引擎重跑即可，无需重新下载 / 导入源数据
 *   （SEM-004）。
 *
 * 落盘由调用方统一执行（与其他写操作共用一次原子写）。
 */

export interface EnrichmentStats {
  /** 命中并写入增强记录的事件数。 */
  matched: number;
  /** 未命中、按普通事件显示的事件数。 */
  unmatched: number;
}

/** 语义栈：增强管线的完整输入，注册方一次装配、调用方整体传入。 */
export interface SemanticStack {
  engine: MatcherEngine;
  resolver?: MetadataResolverStack;
}

/**
 * 分片大小：每处理这么多条事件让出一次主线程（SC-020）。
 * 实测一片约 3ms（10,000 条事件约 60ms 总时长），远小于一帧的预算，
 * 因此整段处理期间界面仍然可绘制、可点击。
 */
export const ENRICH_CHUNK_SIZE = 500;

export interface EnrichmentChunkDeps {
  /** 片间让出主线程的方式；缺省用 MessageChannel 任务（见 scheduling/）。 */
  yieldToMain?: () => Promise<void>;
  /** 分片大小；只供测试注入更小的值，生产路径用 ENRICH_CHUNK_SIZE。 */
  chunkSize?: number;
}

/**
 * 分片执行：每片处理 chunkSize 条事件后 `yield` 一次。
 * 两个公开入口都从这里派生，语义（命中口径、清空时机、写入顺序）只有一处。
 */
function* enrichStoreInChunks(
  store: CalendarStore,
  stack: SemanticStack,
  chunkSize: number = ENRICH_CHUNK_SIZE,
): Generator<void, EnrichmentStats, void> {
  // 取输入这一步本身也要分片（SC-024）：它是逐条克隆（10,000 条约 43 ms），
  // 放在第一个任务里等于把整段重建的门槛留在了主线程上。
  const events = yield* store.listEventsInChunks();
  // 先整体清空再重建：旧 Matcher 的产物（含孤儿记录）不会残留。
  store.clearEnrichments();

  let matched = 0;
  let unmatched = 0;
  let processed = 0;
  for (const stored of events) {
    const view = asNormalizedEvent(stored);
    const result = stack.engine.match(view);
    if (result === null) {
      unmatched += 1;
    } else {
      matched += 1;
      const metadata = stack.resolver?.resolve(result.semantic, view);
      store.saveEnrichment(identityOfEvent(stored), {
        semantic: result.semantic,
        ...(metadata ? { metadata } : {}),
      });
    }
    processed += 1;
    // 末尾不空转：没有下一条事件时不必再让出一次。
    if (processed % chunkSize === 0 && processed < events.length) {
      yield;
    }
  }
  return { matched, unmatched };
}

/**
 * 同步入口：一次跑完。测试与短列表用，不在重建队列里——它在同一个任务内
 * 完成，不会与其他重建交错；生产路径一律走分片入口。
 */
export function reEnrichStore(
  store: CalendarStore,
  stack: SemanticStack,
): EnrichmentStats {
  const steps = enrichStoreInChunks(store, stack);
  let step = steps.next();
  while (!step.done) {
    step = steps.next();
  }
  return step.value;
}

/**
 * 重建队列（按存储）。分片执行让出了主线程，两次重建就可能重叠：后一次会在
 * 前一次的中途清空增强分区，最终分区里就会混着两个快照的产物——旧快照里已被
 * 删除的事件留下永远不再显示的孤儿记录（这正是“先整体清空再重建”要防的事）。
 * 因此同一次存储上的重建排队执行：每次重建都以自己开始时的最新事件集为准，
 * 最后一次完成的结果是权威的。
 */
const rebuildQueueByStore = new WeakMap<CalendarStore, Promise<void>>();

/**
 * 分片入口（SC-020）：片间让出主线程后再继续，导入 / 订阅刷新 / 启动
 * 这三条“事件量由用户数据决定”的路径都走它——大数据量下界面不再整段卡住。
 * 结果与同步入口逐字节相同，只是把一次长阻塞拆成若干短任务。
 */
export function reEnrichStoreYielding(
  store: CalendarStore,
  stack: SemanticStack,
  deps: EnrichmentChunkDeps = {},
): Promise<EnrichmentStats> {
  const previous = rebuildQueueByStore.get(store) ?? Promise.resolve();
  // 前一次失败不阻塞这一次：队列只负责顺序，错误交给各自的调用方。
  const run = previous.then(
    () => runChunkedRebuild(store, stack, deps),
    () => runChunkedRebuild(store, stack, deps),
  );
  rebuildQueueByStore.set(
    store,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function runChunkedRebuild(
  store: CalendarStore,
  stack: SemanticStack,
  deps: EnrichmentChunkDeps,
): Promise<EnrichmentStats> {
  const yieldToMain = deps.yieldToMain ?? defaultYieldToMain;
  const steps = enrichStoreInChunks(
    store,
    stack,
    deps.chunkSize ?? ENRICH_CHUNK_SIZE,
  );
  let step = steps.next();
  while (!step.done) {
    await yieldToMain();
    step = steps.next();
  }
  return step.value;
}
