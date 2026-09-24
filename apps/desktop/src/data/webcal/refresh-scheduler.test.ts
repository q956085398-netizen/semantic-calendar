import { describe, expect, it } from "vitest";
import type { CalendarSource } from "../model";
import {
  WEBCAL_REFRESH_INTERVAL_MS,
  WEBCAL_RETRY_INTERVAL_MS,
  createWebcalScheduler,
  dueWebcalSourceIds,
  nextWebcalRefreshDelay,
  webcalDueAt,
  type TimerHandle,
} from "./refresh-scheduler";

const NOW = Date.parse("2026-10-01T12:00:00.000Z");

function makeWebcalSource(
  overrides: Partial<CalendarSource> = {},
): CalendarSource {
  return {
    id: "webcal:abc",
    type: "webcal",
    name: "公司日历",
    enabled: true,
    lastSyncStatus: "ok",
    lastSyncAt: "2026-10-01T06:00:00.000Z",
    webcal: {
      url: "https://example.com/feed.ics",
      lastCheckedAt: "2026-10-01T06:00:00.000Z",
    },
    ...overrides,
  };
}

describe("到期计算（§12 低频刷新）", () => {
  it("常规间隔为 6 小时，失败后按 30 分钟重试", () => {
    expect(WEBCAL_REFRESH_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
    expect(WEBCAL_RETRY_INTERVAL_MS).toBe(30 * 60 * 1000);

    const healthy = makeWebcalSource();
    expect(webcalDueAt(healthy, NOW)).toBe(
      Date.parse("2026-10-01T06:00:00.000Z") + WEBCAL_REFRESH_INTERVAL_MS,
    );

    const failing = makeWebcalSource({ lastSyncStatus: "error" });
    expect(webcalDueAt(failing, NOW)).toBe(
      Date.parse("2026-10-01T06:00:00.000Z") + WEBCAL_RETRY_INTERVAL_MS,
    );
  });

  it("本地导入来源、停用来源与未到期的订阅都不参与调度", () => {
    expect(
      webcalDueAt(makeWebcalSource({ type: "local-ics" }), NOW),
    ).toBeNull();
    expect(webcalDueAt(makeWebcalSource({ enabled: false }), NOW)).toBeNull();
    expect(
      webcalDueAt(makeWebcalSource({ webcal: undefined }), NOW),
    ).toBeNull();
  });

  it("从未抓取过的订阅立即到期", () => {
    const fresh = makeWebcalSource({
      lastSyncStatus: "never",
      lastSyncAt: undefined,
      webcal: { url: "https://example.com/feed.ics" },
    });

    expect(webcalDueAt(fresh, NOW)).toBe(NOW);
    expect(dueWebcalSourceIds([fresh], NOW)).toEqual(["webcal:abc"]);
  });

  it("时间戳损坏时按需要刷新处理，不永久跳过", () => {
    const broken = makeWebcalSource({
      webcal: {
        url: "https://example.com/feed.ics",
        lastCheckedAt: "不是时间",
      },
    });

    expect(webcalDueAt(broken, NOW)).toBe(NOW);
  });

  it("已过期的订阅进入到期列表，未过期的不会", () => {
    const due = makeWebcalSource({
      id: "webcal:due",
      webcal: {
        url: "https://example.com/a.ics",
        lastCheckedAt: "2026-10-01T05:00:00.000Z",
      },
    });
    const notDue = makeWebcalSource({
      id: "webcal:fresh",
      webcal: {
        url: "https://example.com/b.ics",
        lastCheckedAt: "2026-10-01T11:30:00.000Z",
      },
    });

    expect(dueWebcalSourceIds([due, notDue], NOW)).toEqual(["webcal:due"]);
  });

  it("下一次延迟取最近一个到期时刻，且不为负", () => {
    const overdue = makeWebcalSource({
      id: "webcal:overdue",
      webcal: {
        url: "https://example.com/a.ics",
        lastCheckedAt: "2026-10-01T04:00:00.000Z",
      },
    });
    const later = makeWebcalSource({
      id: "webcal:later",
      webcal: {
        url: "https://example.com/b.ics",
        lastCheckedAt: "2026-10-01T11:00:00.000Z",
      },
    });

    expect(nextWebcalRefreshDelay([overdue, later], NOW)).toBe(0);
    expect(
      nextWebcalRefreshDelay(
        [
          makeWebcalSource({
            webcal: {
              url: "https://example.com/a.ics",
              lastCheckedAt: "2026-10-01T11:00:00.000Z",
            },
          }),
        ],
        NOW,
      ),
    ).toBe(WEBCAL_REFRESH_INTERVAL_MS - 60 * 60 * 1000);
    expect(nextWebcalRefreshDelay([], NOW)).toBeNull();
  });
});

describe("调度器（单个定时器、不重入、可停止）", () => {
  function createHarness(sources: CalendarSource[]) {
    const timers = new Map<number, { handler: () => void; delayMs: number }>();
    const cleared: number[] = [];
    const refreshed: string[] = [];
    let seq = 0;
    const nowMs = NOW;

    const scheduler = createWebcalScheduler({
      listSources: () => sources,
      refresh: async (sourceId) => {
        refreshed.push(sourceId);
        // 刷新成功后把最近尝试时间推进到“现在”，模拟真实刷新服务。
        const source = sources.find((candidate) => candidate.id === sourceId);
        if (source?.webcal) {
          source.webcal.lastCheckedAt = new Date(nowMs).toISOString();
        }
      },
      now: () => nowMs,
      setTimer: (handler, delayMs) => {
        seq += 1;
        timers.set(seq, { handler, delayMs });
        return seq as unknown as TimerHandle;
      },
      clearTimer: (handle) => {
        cleared.push(handle as unknown as number);
        timers.delete(handle as unknown as number);
      },
    });

    return {
      scheduler,
      timers,
      cleared,
      refreshed,
      /** 模拟手动刷新 / 抓取完成后推进最近尝试时间。 */
      markChecked(sourceId: string, iso: string) {
        const source = sources.find((candidate) => candidate.id === sourceId);
        if (source?.webcal) {
          source.webcal.lastCheckedAt = iso;
        }
      },
      /** 触发当前挂起的定时器（模拟时间到达）。 */
      async fire(): Promise<void> {
        const [id, timer] = [...timers.entries()][0] ?? [];
        if (id === undefined || timer === undefined) {
          return;
        }
        timers.delete(id);
        timer.handler();
        // 等一轮微任务，让 runDue 的 await 链走完。
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      },
    };
  }

  it("start 只安排一个定时器，指向最近一次到期", () => {
    const harness = createHarness([
      makeWebcalSource({
        id: "webcal:due",
        webcal: {
          url: "https://example.com/a.ics",
          lastCheckedAt: "2026-10-01T05:00:00.000Z",
        },
      }),
    ]);

    harness.scheduler.start();

    expect(harness.timers.size).toBe(1);
    expect([...harness.timers.values()][0].delayMs).toBe(0);
  });

  it("没有可调度的来源时不持有定时器（空闲零唤醒）", () => {
    const harness = createHarness([
      makeWebcalSource({ enabled: false }),
      makeWebcalSource({ id: "local", type: "local-ics" }),
    ]);

    harness.scheduler.start();

    expect(harness.timers.size).toBe(0);
  });

  it("到期后刷新该来源，并重新安排下一次", async () => {
    const harness = createHarness([
      makeWebcalSource({
        id: "webcal:due",
        webcal: {
          url: "https://example.com/a.ics",
          lastCheckedAt: "2026-10-01T05:00:00.000Z",
        },
      }),
    ]);
    harness.scheduler.start();

    await harness.fire();

    expect(harness.refreshed).toEqual(["webcal:due"]);
    expect(harness.timers.size).toBe(1);
    expect([...harness.timers.values()][0].delayMs).toBe(
      WEBCAL_REFRESH_INTERVAL_MS,
    );
  });

  it("一次触发刷新所有到期来源，未到期的不动", async () => {
    const harness = createHarness([
      makeWebcalSource({
        id: "webcal:a",
        webcal: {
          url: "https://example.com/a.ics",
          lastCheckedAt: "2026-10-01T05:00:00.000Z",
        },
      }),
      makeWebcalSource({
        id: "webcal:b",
        webcal: {
          url: "https://example.com/b.ics",
          lastCheckedAt: "2026-10-01T04:00:00.000Z",
        },
      }),
      makeWebcalSource({
        id: "webcal:fresh",
        webcal: {
          url: "https://example.com/c.ics",
          lastCheckedAt: "2026-10-01T11:30:00.000Z",
        },
      }),
    ]);
    harness.scheduler.start();

    await harness.fire();

    expect(harness.refreshed).toEqual(["webcal:a", "webcal:b"]);
  });

  it("单个来源刷新失败不中断整轮，错误交给 onError", async () => {
    const sources = [
      makeWebcalSource({
        id: "webcal:bad",
        webcal: {
          url: "https://example.com/a.ics",
          lastCheckedAt: "2026-10-01T05:00:00.000Z",
        },
      }),
      makeWebcalSource({
        id: "webcal:good",
        webcal: {
          url: "https://example.com/b.ics",
          lastCheckedAt: "2026-10-01T05:00:00.000Z",
        },
      }),
    ];
    const errors: string[] = [];
    const refreshed: string[] = [];
    const timers = new Map<number, () => void>();
    let seq = 0;
    const scheduler = createWebcalScheduler({
      listSources: () => sources,
      refresh: async (sourceId) => {
        refreshed.push(sourceId);
        if (sourceId === "webcal:bad") {
          throw new Error("网络请求失败");
        }
      },
      now: () => NOW,
      setTimer: (handler) => {
        seq += 1;
        timers.set(seq, handler);
        return seq as unknown as TimerHandle;
      },
      clearTimer: (handle) => {
        timers.delete(handle as unknown as number);
      },
      onError: (error, sourceId) => {
        errors.push(`${sourceId}:${(error as Error).message}`);
      },
    });

    scheduler.start();
    const handler = [...timers.values()][0];
    handler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(refreshed).toEqual(["webcal:bad", "webcal:good"]);
    expect(errors).toEqual(["webcal:bad:网络请求失败"]);
  });

  it("stop 取消挂起的定时器，且不再安排新的", async () => {
    const harness = createHarness([
      makeWebcalSource({
        webcal: {
          url: "https://example.com/a.ics",
          lastCheckedAt: "2026-10-01T05:00:00.000Z",
        },
      }),
    ]);
    harness.scheduler.start();

    harness.scheduler.stop();

    expect(harness.cleared).toEqual([1]);
    expect(harness.timers.size).toBe(0);
    await harness.fire();
    expect(harness.refreshed).toEqual([]);
  });

  it("reschedule 基于最新状态重新安排（手动刷新后调用）", () => {
    const harness = createHarness([
      makeWebcalSource({
        id: "webcal:abc",
        webcal: {
          url: "https://example.com/a.ics",
          lastCheckedAt: "2026-10-01T05:00:00.000Z",
        },
      }),
    ]);
    harness.scheduler.start();
    expect([...harness.timers.values()][0].delayMs).toBe(0);

    // 手动刷新把最近尝试时间推到 11:30，下一次应在 6 小时后（距今 5.5 小时）。
    harness.markChecked("webcal:abc", "2026-10-01T11:30:00.000Z");
    harness.scheduler.reschedule();

    expect(harness.cleared).toEqual([1]);
    expect(harness.timers.size).toBe(1);
    expect([...harness.timers.values()][0].delayMs).toBe(
      WEBCAL_REFRESH_INTERVAL_MS - 30 * 60 * 1000,
    );
  });
});
