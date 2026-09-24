import {
  dueReminders,
  expiredReminders,
  nextReminder,
  nextReminderDelay,
  type PlannedReminder,
} from "./reminder-plan";
import type { ReminderOutcome } from "./fired-reminders";

/**
 * 提醒调度（SC-017 / app-spec §12「下一条通知调度」）。
 *
 * 与 WebCal 刷新调度同一形状（data/webcal/refresh-scheduler.ts），因为它
 * 面向同一条约束：允许的后台唤醒只有“到达下一条提醒时间”与跨天重算，
 * 不做任何轮询。
 * - 只维护一个 setTimeout，指向最近一次需要动作的时刻；
 * - 触发时只处理一次到期集合，不重入。
 *
 * 为什么还要“跨天”这一个唤醒：提醒计划窗口是「当前日期起 N 天」，而日期
 * 会变化。若只在有提醒时排程，长期常驻且期间没有任何数据变化的会话会一直
 * 用启动那天的窗口，落在窗口之外的事件永远排不进计划。跨天唤醒让窗口跟着
 * 日期滑动，代价是每个自然日一次唤醒（应用没运行时不会有任何唤醒）。
 *
 * 已处理状态由调用方持久化（mark 回调）；调度器另外在内存里记住本次会话
 * 已处理的 id，即使落盘失败也不会在同一会话里重复弹同一条提醒。
 */

/** setTimeout 的延迟上限（2^31-1），超出会被截断成立即触发。 */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

export type TimerHandle = ReturnType<typeof setTimeout>;

/** 距离下一个本地零点的毫秒数（跨天重算用，恒在 (0, 24h] 内）。 */
export function nextDayRolloverDelay(nowMs: number): number {
  const now = new Date(nowMs);
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.max(0, midnight.getTime() - nowMs);
}

export interface NotificationSchedulerDeps {
  /** 当前计划（由 App 用事件 + 设置算出，见 reminder-plan）。 */
  plan: () => PlannedReminder[];
  /** 发送一条提醒；失败不应中断其余提醒。 */
  send: (reminder: PlannedReminder) => Promise<unknown>;
  /** 记录一条提醒的结局：fired 已发送 / expired 已错过窗口（NOTIFY-004）。 */
  mark: (reminder: PlannedReminder, outcome: ReminderOutcome) => void;
  /**
   * 重算计划（跨天时读时钟重排）。缺省用 deps.plan；App 传自己的重算函数，
   * 因为计划窗口要按“当前日期”而不是“启动日期”计算。
   */
  replan?: () => PlannedReminder[];
  now?: () => number;
  setTimer?: (handler: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  onError?: (error: unknown, reminder: PlannedReminder) => void;
  /** 计划变化（重排 / 触发 / 过期）后的回调，供界面刷新“下一条提醒”。 */
  onPlanChange?: () => void;
}

export interface NotificationScheduler {
  start(): void;
  stop(): void;
  /** 事件 / 设置变化后调用，让下一次计划基于最新状态。 */
  reschedule(): void;
  /** 下一条待触发提醒；没有计划时为 null。 */
  nextReminder(): PlannedReminder | null;
  /** 待触发提醒条数（不含已处理）。 */
  pendingCount(): number;
}

export function createNotificationScheduler(
  deps: NotificationSchedulerDeps,
): NotificationScheduler {
  const now = deps.now ?? (() => Date.now());
  const setTimer =
    deps.setTimer ?? ((handler, delayMs) => setTimeout(handler, delayMs));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));

  let timer: TimerHandle | undefined;
  let running = false;
  let stopped = true;
  /** 本会话已处理的提醒 id：落盘失败时的最后一道去重防线。 */
  const handled = new Set<string>();

  function pending(): PlannedReminder[] {
    return deps.plan().filter((reminder) => !handled.has(reminder.id));
  }

  function schedule(): void {
    if (stopped) {
      return;
    }
    if (timer !== undefined) {
      clearTimer(timer);
      timer = undefined;
    }
    const nowMs = now();
    // 跨天唤醒同时承担“没有待触发提醒时的重算”：延迟取两者中更早的一个。
    const reminderDelay = nextReminderDelay(pending(), nowMs);
    const delay =
      reminderDelay === null
        ? nextDayRolloverDelay(nowMs)
        : Math.min(reminderDelay, nextDayRolloverDelay(nowMs));
    timer = setTimer(
      () => {
        timer = undefined;
        void runDue();
      },
      Math.min(delay, MAX_TIMER_DELAY_MS),
    );
    deps.onPlanChange?.();
  }

  async function runDue(): Promise<void> {
    // 运行中不重入：一轮处理可能跨越多个到期时刻。
    if (stopped || running) {
      return;
    }
    running = true;
    try {
      // 跨天唤醒时重新计算计划：窗口是按当前日期给的（见文件头注释）。
      const reminders = (deps.replan ?? deps.plan)().filter(
        (reminder) => !handled.has(reminder.id),
      );
      const nowMs = now();
      // 错过窗口的先标记为已处理，避免下次启动又当成“到期未发”反复尝试。
      for (const reminder of expiredReminders(reminders, nowMs)) {
        markHandled(reminder, "expired");
      }
      for (const reminder of dueReminders(
        reminders.filter((candidate) => !handled.has(candidate.id)),
        nowMs,
      )) {
        if (stopped) {
          return;
        }
        if (handled.has(reminder.id)) {
          continue;
        }
        try {
          await deps.send(reminder);
        } catch (error) {
          // 发送失败同样记为已处理：同一提醒不反复弹（NOTIFY-004），
          // 失败原因通过 onError 交给界面解释（§13）。
          deps.onError?.(error, reminder);
        } finally {
          markHandled(reminder, "fired");
        }
      }
    } finally {
      running = false;
      schedule();
    }
  }

  function markHandled(
    reminder: PlannedReminder,
    outcome: ReminderOutcome,
  ): void {
    handled.add(reminder.id);
    deps.mark(reminder, outcome);
  }

  return {
    start() {
      stopped = false;
      schedule();
    },
    stop() {
      stopped = true;
      if (timer !== undefined) {
        clearTimer(timer);
        timer = undefined;
      }
    },
    reschedule() {
      schedule();
    },
    nextReminder() {
      return nextReminder(pending());
    },
    pendingCount() {
      return pending().length;
    },
  };
}
