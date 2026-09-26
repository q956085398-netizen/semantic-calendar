import { shiftDateKey } from "../calendar/month-grid";
import type { EnrichedEvent } from "../data/model";
import {
  OCCURRENCE_CHUNK_EVENTS,
  expandEventOccurrencesInChunks,
} from "../normalize/occurrences";
import {
  createTimeSlicedRun,
  type TimeSlicedDeps,
  type TimeSlicedRun,
} from "../scheduling/time-sliced";
import type { MatchReminderSetting } from "./notification-settings";
import {
  REMINDER_HORIZON_DAYS,
  planReminders,
  type PlannedReminder,
} from "./reminder-plan";

/**
 * 提醒计划的分片重建（SC-020）。
 *
 * 提醒计划的输入是「当前日期起 30 天」窗口里展开好的 occurrence，展开与月切换
 * 共用同一个函数。改动前展开与计划都在调度器那一次调用里同步完成：10,000 条
 * 事件下每次数据变化（导入 / 刷新 / 启动）都有约 159 ms 不中断（展开 154 ms +
 * 计划 4.6 ms，performance.md §6）。这里把展开拆成短任务，计划本身留在最后
 * 一片之后（它是一次线性遍历，约 4.6 ms）。
 *
 * **调度器接口不动**：它的 `plan` / `replan` 仍然是同步回调。App 持有一份
 * 「最近一次算完的计划」供它们读，重建在后台分片进行、完成后让调度器重排。
 * 因此这里的入口只负责算，不负责什么时候算、也不负责发布。
 *
 * 已处理提醒（NOTIFY-004）**不在重建时过滤**：那样每弹一条提醒、每次重启恢复
 * 去重日志都要重建一次计划。读取方在取计划时按当前的去重日志过滤即可——日志
 * 是几十到几百条的小集合，过滤是常数开销，而且不会因为「重建晚到」而重复弹。
 */
export interface ReminderPlanInput {
  events: readonly EnrichedEvent[];
  /** 计划窗口起点（今天，日期键 YYYY-MM-DD）。 */
  from: string;
  notificationsEnabled: boolean;
  matchReminder: MatchReminderSetting;
  nowMs: number;
  horizonDays?: number;
}

export interface ReminderPlanLoadDeps extends TimeSlicedDeps {
  /** 分片粒度；只供测试注入更小的值。 */
  chunkEvents?: number;
}

/** 分片重建一次提醒计划；结果与 `planReminders` 的同步路径逐条相同。 */
export function createReminderPlanLoad(
  input: ReminderPlanInput,
  deps: ReminderPlanLoadDeps = {},
): TimeSlicedRun<PlannedReminder[]> {
  return createTimeSlicedRun(
    reminderPlanInChunks(input, deps.chunkEvents),
    deps,
  );
}

function* reminderPlanInChunks(
  input: ReminderPlanInput,
  chunkEvents: number | undefined,
): Generator<void, PlannedReminder[], void> {
  const horizonDays = input.horizonDays ?? REMINDER_HORIZON_DAYS;
  const occurrences = yield* expandEventOccurrencesInChunks(
    input.events,
    { from: input.from, to: shiftDateKey(input.from, horizonDays) },
    chunkEvents ?? OCCURRENCE_CHUNK_EVENTS,
  );
  return planReminders({
    events: occurrences,
    notificationsEnabled: input.notificationsEnabled,
    matchReminder: input.matchReminder,
    nowMs: input.nowMs,
    horizonDays,
  });
}
