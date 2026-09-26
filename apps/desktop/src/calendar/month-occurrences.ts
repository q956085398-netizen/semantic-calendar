import type { EnrichedEvent } from "../data/model";
import {
  expandEventOccurrencesInChunks,
  type OccurrenceWindow,
} from "../normalize/occurrences";
import { bucketEventsByDateKey } from "./event-buckets";
import type { MonthGrid } from "./month-grid";

/**
 * 月视图读取路径的分片展开（SC-020 / app-spec §15「大量事件不应阻塞 UI 线程」
 * 与「月视图切换应感知即时」）。
 *
 * 改动前这一段是一个 `useMemo` 里的同步展开：10,000 条事件 158 ms 不让出主
 * 线程，切换月份就是一次可感知的卡顿（见 performance.md §6 的记录）。这里把
 * 它拆成若干短任务：
 *
 * - **按时间预算让出**：一个任务连续算到超出 MONTH_TASK_BUDGET_MS 就返回，
 *   调用方（calendar/use-month-occurrences）在任务之间让出主线程；
 * - **小数据一步到位**：常见规模在第一个任务里就算完，界面首帧就有完整月格，
 *   不会出现“先空一下再填上”的闪烁——分片只在数据量真的会卡住时才生效；
 * - **未算完不发布半份结果**：整理期间给空 Map，界面配状态行说明原因。发布
 *   半份结果会让月格、详情栏与“当天有几件事”在几帧内反复变化，那是比短暂
 *   空白更难解释的状态；
 * - **语义只有一处**：展开本身复用 normalize/occurrences 的同一个生成器，
 *   与同步入口 `expandEventOccurrences` 是同一次排空，不存在两套展开逻辑。
 */

/**
 * 让出阈值（ms）：一个任务连续算满这么久就让出主线程。
 *
 * 名字刻意不叫「预算 / 上限」——它是**软阈值**，不是任务的时长上界：
 * 时间检查发生在每片之后，因此实际一次任务 = 阈值 + 一片（128 条事件），
 * 最后一次任务还要多做一次分桶（10,000 条 occurrence 约 5 ms）。实测一次
 * 任务 5.4–8.6 ms、最坏（末次）约 14 ms，都仍在一帧（16.7 ms）以内；
 * 数字见 performance.md §3.3。取 5 ms 而不是一帧，是给“片比预期慢”留余量。
 */
export const MONTH_YIELD_AFTER_MS = 5;

/**
 * 分片粒度（事件条数）：生成器每这么多条让出一次，也是时间检查的频率。
 * 与语义增强的分片（ENRICH_CHUNK_SIZE = 500）不同，这里的每条事件更贵
 * （重复规则展开、时区换算），粒度因此更细。
 */
export const MONTH_CHUNK_EVENTS = 128;

/** 网格覆盖的日期窗口（含前后补格）。月格展示哪些日期，展开就覆盖哪些日期。 */
export function occurrenceWindowOf(grid: MonthGrid): OccurrenceWindow {
  const lastWeek = grid.weeks[grid.weeks.length - 1];
  return {
    from: grid.weeks[0][0].dateKey,
    to: lastWeek[lastWeek.length - 1].dateKey,
  };
}

/** 按日期键分桶的事件；只读——整理期间的共享空 Map 与算完的结果都从这里出去。 */
export type OccurrenceBuckets = ReadonlyMap<string, EnrichedEvent[]>;

export interface MonthOccurrences {
  /** 当前窗口的完整分桶；整理期间是空 Map（配 pending 一起看）。 */
  buckets: OccurrenceBuckets;
  /** 还在整理：月格暂时没有事件，文案见 monthOccurrencePendingText。 */
  pending: boolean;
}

/**
 * 整理期间共用的空 Map：身份稳定，pending 的每一帧不会换一个新对象
 * （下游按引用比较时不会白重渲染）。类型是只读的，写不进去。
 */
const PENDING_BUCKETS: OccurrenceBuckets = new Map();

export interface MonthOccurrenceLoadDeps {
  /** 读时钟；只供测试注入确定性时钟。 */
  now?: () => number;
  /** 让出阈值；只供测试注入更小的值。 */
  yieldAfterMs?: number;
  /** 分片粒度；只供测试注入更小的值。 */
  chunkEvents?: number;
}

export interface MonthOccurrenceLoad {
  /** 当前可用于渲染的结果。 */
  result(): MonthOccurrences;
  /** 还有未完成的分片。 */
  hasWork(): boolean;
  /**
   * 跑一个任务：连续分片直到算完或越过让出阈值。
   * 返回是否还有剩余工作——调用方据此决定要不要让出主线程后再来一次。
   */
  advance(): boolean;
}

/**
 * 一次月视图读取：给定事件与窗口，分片算出日期分桶。
 *
 * 不持有定时器、不自己让出主线程：让出时机属于调用方（React 侧由 hook 在
 * effect 里驱动），因此这里可以同步调用、可测试，也不存在悬空的异步循环。
 */
export function createMonthOccurrenceLoad(
  input: { events: readonly EnrichedEvent[]; window: OccurrenceWindow },
  deps: MonthOccurrenceLoadDeps = {},
): MonthOccurrenceLoad {
  const now = deps.now ?? defaultNow;
  const yieldAfterMs = deps.yieldAfterMs ?? MONTH_YIELD_AFTER_MS;
  const steps = expandEventOccurrencesInChunks(
    input.events,
    input.window,
    deps.chunkEvents ?? MONTH_CHUNK_EVENTS,
  );

  /** 算完后的分桶；undefined 表示还有分片没跑。 */
  let buckets: OccurrenceBuckets | undefined;

  return {
    result(): MonthOccurrences {
      return buckets === undefined
        ? { buckets: PENDING_BUCKETS, pending: true }
        : { buckets, pending: false };
    },
    hasWork(): boolean {
      return buckets === undefined;
    },
    advance(): boolean {
      if (buckets !== undefined) {
        return false;
      }
      const taskStart = now();
      // 先跑一片再问时间：阈值再小也至少有进展，不会空转。
      for (;;) {
        const step = steps.next();
        if (step.done) {
          // 最后一片之后的分桶也在这个任务里完成：它是一次线性扫描，
          // 实测 10,000 条事件的 occurrence 约 5 ms（performance.md §3.3）。
          buckets = bucketEventsByDateKey(step.value);
          return false;
        }
        if (now() - taskStart >= yieldAfterMs) {
          return true;
        }
      }
    },
  };
}

/** 状态行文案（§13 可解释）：说明月格暂时为空的原因与工作量。 */
export function monthOccurrencePendingText(total: number): string {
  return `正在整理事件（${groupedCount(total)} 条）…`;
}

/** 千分位分组：条数要能一眼读出量级，且不依赖运行环境的 locale。 */
function groupedCount(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function defaultNow(): number {
  return performance.now();
}
