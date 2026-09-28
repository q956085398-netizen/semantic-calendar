import { useEffect, useMemo, useReducer } from "react";
import type { EnrichedEvent } from "../data/model";
import { yieldToMain } from "../scheduling/yield-to-main";
import { createMonthOccurrenceLoad } from "./month-occurrences";

const EMPTY_EVENTS: EnrichedEvent[] = [];

/**
 * Inspector 的单日 occurrence 读取。
 *
 * 月份导航会保留用户选中的日期，所以该日期可能离开当前网格。此时按单日
 * 窗口展开与月格相同的 occurrence 规则；大日历继续分片，并在完整结果就绪
 * 前返回 pending，避免用空列表冒充“当天没有事件”。
 */
export function useSelectedDateOccurrences(
  events: readonly EnrichedEvent[],
  dateKey: string,
  enabled: boolean,
): { events: EnrichedEvent[]; pending: boolean } {
  const [, bump] = useReducer((version: number) => version + 1, 0);
  const load = useMemo(() => {
    if (!enabled) return undefined;
    const next = createMonthOccurrenceLoad({
      events,
      window: { from: dateKey, to: dateKey },
    });
    next.advance();
    return next;
  }, [dateKey, enabled, events]);

  useEffect(() => {
    if (!load?.hasWork()) return;
    let stopped = false;
    void (async () => {
      while (!stopped && load.hasWork()) {
        await yieldToMain();
        if (stopped) return;
        load.advance();
      }
      if (!stopped) bump();
    })();
    return () => {
      stopped = true;
    };
  }, [load]);

  const result = load?.result();
  return {
    events: result?.buckets.get(dateKey) ?? EMPTY_EVENTS,
    pending: result?.pending ?? false,
  };
}
