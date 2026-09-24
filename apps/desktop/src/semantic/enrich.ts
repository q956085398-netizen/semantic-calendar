import { asNormalizedEvent, identityOfEvent } from "../data/model";
import type { CalendarStore } from "../data/store/calendar-store";
import type { MatcherEngine } from "./matcher-engine";
import type { MetadataResolverStack } from "./metadata-resolver";

/**
 * 语义增强管线（SC-009，app-spec §7 主链路的 Matcher → Semantic →
 * Metadata 段）。
 *
 * - 只写增强分区（enrichments），原始事件分区分毫不动（验收：
 *   “原始数据不被覆盖”）；
 * - 未命中不写记录，读取侧自动按普通事件显示（SEM-003）；
 * - 重建入口唯一（reEnrichStore）：Matcher 更新后换引擎重跑即可，
 *   无需重新下载 / 导入源数据（SEM-004）。
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

export function reEnrichStore(
  store: CalendarStore,
  stack: SemanticStack,
): EnrichmentStats {
  const events = store.listEvents();
  // 先整体清空再重建：旧 Matcher 的产物（含孤儿记录）不会残留。
  store.clearEnrichments();

  let matched = 0;
  let unmatched = 0;
  for (const stored of events) {
    const view = asNormalizedEvent(stored);
    const result = stack.engine.match(view);
    if (result === null) {
      unmatched += 1;
      continue;
    }
    matched += 1;
    const metadata = stack.resolver?.resolve(result.semantic, view);
    store.saveEnrichment(identityOfEvent(stored), {
      semantic: result.semantic,
      ...(metadata ? { metadata } : {}),
    });
  }
  return { matched, unmatched };
}
