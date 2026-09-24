import { describe, expect, it } from "vitest";
import type { PlannedReminder } from "./reminder-plan";
import { REMINDER_LATE_TOLERANCE_MS } from "./reminder-plan";
import {
  createNotificationScheduler,
  nextDayRolloverDelay,
  type TimerHandle,
} from "./notification-scheduler";
import { handledReminderIds, type HandledReminder } from "./fired-reminders";

/**
 * SC-017 / NOTIFY-004、app-spec §12：提醒调度。
 *
 * 关键行为：到点发送一次、重启后不重复弹（未触发的仍会触发）、错过的提醒
 * 不补发、任何时刻只有一个定时器（下一条提醒或跨天重算），没有轮询。
 */

const T0 = Date.parse("2026-09-23T12:00:00.000Z");

function reminder(
  id: string,
  fireAtMs: number,
  title = "晚间例会",
): PlannedReminder {
  return {
    id,
    eventId: "src\u0000uid",
    fireAtMs,
    title,
    body: "19:00 · 提前 10 分钟",
    source: "event-alarm",
  };
}

/**
 * 调度器测试台：定时器回调由测试显式触发，因此不需要真实等待时间，
 * 也能量到“此刻有几个定时器”与“延迟是多少”（§12 不轮询的可执行断言）。
 */
function createHarness(
  initialPlan: PlannedReminder[],
  options: {
    send?: (reminder: PlannedReminder) => Promise<unknown>;
    /** mark 是否把提醒从计划中移除（模拟落盘成功）。 */
    dropOnMark?: boolean;
    nowMs?: number;
    /** 跨天重算时返回的计划（模拟“日期变了，窗口里出现新事件”）。 */
    replan?: () => PlannedReminder[];
    onPlanChange?: () => void;
  } = {},
) {
  let planned = [...initialPlan];
  let nowMs = options.nowMs ?? T0;
  let timer: (() => void) | null = null;
  const sent: PlannedReminder[] = [];
  const marked: Array<{ id: string; outcome: string }> = [];
  const errors: unknown[] = [];
  const delays: number[] = [];

  const scheduler = createNotificationScheduler({
    plan: () => planned,
    // 重算结果就是之后的计划（真实接线里 plan 与 replan 是同一个函数）。
    ...(options.replan
      ? {
          replan: () => {
            planned = [...options.replan!()];
            return planned;
          },
        }
      : {}),
    send: async (entry) => {
      sent.push(entry);
      if (options.send) {
        await options.send(entry);
      }
    },
    mark: (entry, outcome) => {
      marked.push({ id: entry.id, outcome });
      if (options.dropOnMark !== false) {
        planned = planned.filter((candidate) => candidate.id !== entry.id);
      }
    },
    now: () => nowMs,
    setTimer: (handler, delayMs) => {
      timer = handler;
      delays.push(delayMs);
      return 0 as unknown as TimerHandle;
    },
    clearTimer: () => {
      timer = null;
    },
    onError: (error) => errors.push(error),
    ...(options.onPlanChange ? { onPlanChange: options.onPlanChange } : {}),
  });

  return {
    scheduler,
    sent,
    marked,
    errors,
    delays,
    hasTimer: () => timer !== null,
    setNow: (next: number) => {
      nowMs = next;
    },
    setPlan: (next: PlannedReminder[]) => {
      planned = next;
    },
    /** 触发当前定时器并等待异步链跑完。 */
    async fire() {
      const handler = timer;
      timer = null;
      if (handler) {
        handler();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
  };
}

describe("提醒调度（SC-017 / app-spec §12）", () => {
  it("到点后发送并记为已发送", async () => {
    const harness = createHarness([reminder("a", T0 - 60_000)]);
    harness.scheduler.start();
    await harness.fire();

    expect(harness.sent.map((entry) => entry.id)).toEqual(["a"]);
    expect(harness.marked).toEqual([{ id: "a", outcome: "fired" }]);
  });

  it("未到点时定时器指向那一条，不是轮询", () => {
    const harness = createHarness([reminder("later", T0 + 30 * 60_000)]);
    harness.scheduler.start();

    expect(harness.sent).toEqual([]);
    expect(harness.delays).toEqual([30 * 60_000]);
    expect(harness.scheduler.nextReminder()?.id).toBe("later");
    expect(harness.scheduler.pendingCount()).toBe(1);
  });

  it("没有待触发提醒时也只保留一个跨天定时器", () => {
    const noon = new Date(2026, 8, 23, 12, 0).getTime();
    const harness = createHarness([], { nowMs: noon });
    harness.scheduler.start();

    expect(harness.sent).toEqual([]);
    expect(harness.scheduler.nextReminder()).toBeNull();
    expect(harness.scheduler.pendingCount()).toBe(0);
    // 跨天重算：12 小时后到本地零点，期间不会有别的唤醒。
    expect(harness.delays).toEqual([12 * 60 * 60 * 1000]);
  });

  it("最近的一条提醒比跨天更早时，以提醒为准", () => {
    const harness = createHarness([reminder("soon", T0 + 5 * 60_000)]);
    harness.scheduler.start();

    expect(harness.delays).toEqual([5 * 60_000]);
  });

  it("跨天唤醒会重算计划（窗口跟着日期滑动）", async () => {
    let replans = 0;
    let rolloverPlan: PlannedReminder[] = [];
    const harness = createHarness([], {
      nowMs: new Date(2026, 8, 23, 12, 0).getTime(),
      replan: () => {
        replans += 1;
        return rolloverPlan;
      },
    });
    harness.scheduler.start();
    expect(replans).toBe(0);

    // 跨天之后窗口里出现了一条新提醒：重算才会看到它。
    rolloverPlan = [reminder("tomorrow", T0 + 60_000)];
    await harness.fire();

    expect(replans).toBe(1);
    expect(harness.scheduler.nextReminder()?.id).toBe("tomorrow");
  });

  it("错过的提醒记为已错过，不补发", async () => {
    const harness = createHarness([
      reminder("missed", T0 - REMINDER_LATE_TOLERANCE_MS - 1),
    ]);
    harness.scheduler.start();
    await harness.fire();

    expect(harness.sent).toEqual([]);
    expect(harness.marked).toEqual([{ id: "missed", outcome: "expired" }]);
  });

  it("发送失败也记为已发送，同一提醒不再重复弹（NOTIFY-004）", async () => {
    const harness = createHarness([reminder("fail", T0 - 60_000)], {
      send: async () => {
        throw { kind: "send-failed", message: "系统拒绝" };
      },
    });
    harness.scheduler.start();
    await harness.fire();

    expect(harness.errors).toHaveLength(1);
    expect(harness.marked).toEqual([{ id: "fail", outcome: "fired" }]);
    expect(harness.scheduler.pendingCount()).toBe(0);
  });

  it("计划未清干净时也不会重复发送（本会话兜底去重）", async () => {
    // dropOnMark: false 模拟“落盘失败 / 计划实现没排除已处理项”。
    const harness = createHarness([reminder("again", T0 - 60_000)], {
      dropOnMark: false,
    });
    harness.scheduler.start();
    await harness.fire();
    harness.scheduler.reschedule();
    await harness.fire();

    expect(harness.sent.map((entry) => entry.id)).toEqual(["again"]);
    expect(harness.marked).toEqual([{ id: "again", outcome: "fired" }]);
  });

  it("stop 之后不再触发，并清掉定时器", async () => {
    const harness = createHarness([reminder("a", T0 - 60_000)]);
    harness.scheduler.start();
    harness.scheduler.stop();
    await harness.fire();

    expect(harness.hasTimer()).toBe(false);
    expect(harness.sent).toEqual([]);
  });

  it("重启恢复：已处理的提醒不再触发，未触发的仍然会触发（NOTIFY-004）", async () => {
    const fired = reminder("fired", T0 - 60_000);
    const pending = reminder("pending", T0 + 60_000, "另一场比赛");
    const first = createHarness([fired, pending]);
    first.scheduler.start();
    await first.fire();
    expect(first.sent.map((entry) => entry.id)).toEqual(["fired"]);

    // 重启：日志（去重键）从快照读回，计划里只剩下未触发的那条。
    const persisted: HandledReminder[] = first.marked.map((entry) => ({
      id: entry.id,
      at: new Date(T0).toISOString(),
      outcome: "fired",
    }));
    const handled = handledReminderIds(persisted);
    const restoredPlan = [fired, pending].filter(
      (entry) => !handled.has(entry.id),
    );
    expect(restoredPlan.map((entry) => entry.id)).toEqual(["pending"]);

    const second = createHarness(restoredPlan);
    second.scheduler.start();
    // 时间推进到那条未触发提醒的时刻：它照常触发。
    second.setNow(T0 + 120_000);
    await second.fire();

    expect(second.sent.map((entry) => entry.id)).toEqual(["pending"]);
    expect(second.scheduler.pendingCount()).toBe(0);
  });

  it("计划变化时通过 onPlanChange 通知界面刷新下一条提醒", () => {
    let changes = 0;
    const harness = createHarness([reminder("later", T0 + 60_000)], {
      onPlanChange: () => {
        changes += 1;
      },
    });
    harness.scheduler.start();

    expect(changes).toBeGreaterThan(0);
    expect(harness.scheduler.nextReminder()?.title).toBe("晚间例会");
  });

  it("计划清空后重排不会留下旧定时器", () => {
    const harness = createHarness([reminder("a", T0 + 60_000)]);
    harness.scheduler.start();
    harness.setPlan([]);
    harness.scheduler.reschedule();

    expect(harness.scheduler.pendingCount()).toBe(0);
    // 剩下的只有跨天定时器（重新排过，因此延迟记录不止一条）。
    expect(harness.delays.length).toBeGreaterThan(1);
  });
});

describe("跨天延迟", () => {
  it("从任意时刻到下一个本地零点", () => {
    expect(
      nextDayRolloverDelay(new Date(2026, 8, 23, 12, 0, 0).getTime()),
    ).toBe(12 * 60 * 60 * 1000);
    expect(
      nextDayRolloverDelay(new Date(2026, 8, 23, 23, 59, 30).getTime()),
    ).toBe(30_000);
    // 恰好零点：下一个零点是一整天之后，不会退化成 0 延迟的死循环。
    expect(nextDayRolloverDelay(new Date(2026, 8, 24, 0, 0, 0).getTime())).toBe(
      24 * 60 * 60 * 1000,
    );
  });
});
