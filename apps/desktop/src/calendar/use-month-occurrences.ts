import { useEffect, useMemo, useReducer, useRef } from "react";
import type { EnrichedEvent } from "../data/model";
import type { OccurrenceWindow } from "../normalize/occurrences";
import { yieldToMain as defaultYieldToMain } from "../scheduling/yield-to-main";
import type { MonthGrid } from "./month-grid";
import {
  createMonthOccurrenceLoad,
  occurrenceWindowOf,
  type MonthOccurrenceLoad,
  type MonthOccurrenceLoadDeps,
  type OccurrenceBuckets,
} from "./month-occurrences";

/**
 * 月视图读取路径的 React 接线（SC-020）。
 *
 * 三件事分开：
 * - **第一个任务在渲染期跑**（useMemo 里一次 advance）：约 200 条事件以下的
 *   日历就此算完，首帧就是完整月格——分片只在大数据量上生效，不会给所有人
 *   加一次闪烁。这一步是纯计算（展开 + 分桶），没有 I/O、不写状态，重复执行
 *   结果相同；
 * - **剩余任务在 effect 里推进**：每个任务之间让出主线程，让出的方式来自
 *   scheduling/yield-to-main（MessageChannel 任务，不受隐藏页面定时器节流）；
 * - **结果发布是整份的**：算完之前 `pending` 为 true、`eventsByDate` 为空，
 *   界面用 monthOccurrencePendingText 说明原因。半份结果会让月格与详情栏在
 *   几帧内反复变化，比一次短暂的空白更难解释。
 *
 * 缓存键是「事件数组身份 + 窗口日期」：窗口没变而事件换了（导入 / 刷新 /
 * 设置开关）必须重算，两者都没变的重渲染（主题、选中日期、侧栏折叠）不重算。
 * 切换月份时旧的加载被替换，其未完成的循环在下一次让出后自行停止。
 */

export interface MonthOccurrencesView {
  /** 当前窗口的完整分桶；整理期间是空 Map。 */
  eventsByDate: OccurrenceBuckets;
  /** 还在整理：月格暂时没有事件（文案见 monthOccurrencePendingText）。 */
  pending: boolean;
}

export interface MonthOccurrencesOptions extends MonthOccurrenceLoadDeps {
  /** 任务之间让出主线程的方式；缺省用 MessageChannel 任务（见 scheduling/）。 */
  yieldToMain?: () => Promise<void>;
}

interface CachedLoad {
  events: readonly EnrichedEvent[];
  window: OccurrenceWindow;
  load: MonthOccurrenceLoad;
}

export function useMonthOccurrences(
  events: readonly EnrichedEvent[],
  grid: MonthGrid,
  deps: MonthOccurrencesOptions = {},
): MonthOccurrencesView {
  const window = useMemo(() => occurrenceWindowOf(grid), [grid]);
  // 让出方式与时钟只由调用方（或测试）注入，不参与记忆化键。
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const cacheRef = useRef<CachedLoad | undefined>(undefined);
  const [, bump] = useReducer((version: number) => version + 1, 0);

  const load = useMemo(() => {
    const cached = cacheRef.current;
    if (
      cached !== undefined &&
      cached.events === events &&
      sameWindow(cached.window, window)
    ) {
      return cached.load;
    }
    const fresh = createMonthOccurrenceLoad(
      { events, window },
      depsRef.current,
    );
    cacheRef.current = { events, window, load: fresh };
    // 第一个任务：小数据在这里结束，本次渲染即拿到完整月格。
    fresh.advance();
    return fresh;
  }, [events, window]);

  useEffect(() => {
    if (!load.hasWork()) {
      return;
    }
    let stopped = false;
    void (async () => {
      while (!stopped && load.hasWork()) {
        await (depsRef.current.yieldToMain ?? defaultYieldToMain)();
        if (stopped) {
          return;
        }
        load.advance();
      }
      if (!stopped) {
        // 结果已就位，只是需要一次重渲染把它交给界面。
        bump();
      }
    })();
    return () => {
      stopped = true;
    };
  }, [load]);

  const result = load.result();
  return { eventsByDate: result.buckets, pending: result.pending };
}

/** 窗口按日期比较：`grid` 换新对象但覆盖同一段日期时，不该重算。 */
function sameWindow(a: OccurrenceWindow, b: OccurrenceWindow): boolean {
  return a.from === b.from && a.to === b.to;
}
