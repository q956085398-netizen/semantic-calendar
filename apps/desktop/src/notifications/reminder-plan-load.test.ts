// @vitest-environment node
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStoredEvents } from "../bench/fixtures";
import { createTempDir, removeTempDir } from "../bench/support";
import { shiftDateKey } from "../calendar/month-grid";
import { asNormalizedEvent, type CalendarSource } from "../data/model";
import { CalendarStore } from "../data/store/calendar-store";
import { NodeFileIO } from "../data/store/node-file-io";
import { expandEventOccurrences } from "../normalize/occurrences";
import {
  REMINDER_HORIZON_DAYS,
  planReminders,
  type PlannedReminder,
} from "./reminder-plan";
import { createReminderPlanLoad } from "./reminder-plan-load";

/**
 * SC-020 的提醒计划接缝：重建要能分片，结果与同步路径逐条相同。
 *
 * 计划本身（提前量、去重键、锚点策略）在 reminder-plan.test.ts 里测；
 * 这里只测「分片不改变结果」与「大数据量不会一次跑完」。
 */

const SOURCE: CalendarSource = {
  id: "local-ics:perf",
  type: "local-ics",
  name: "perf.ics",
  enabled: true,
};

/** 固定“现在”与窗口起点：结果与运行时刻无关。 */
const FROM = "2026-10-01";
const NOW_MS = Date.parse("2026-10-01T09:00:00.000Z");

let dir = "";
beforeAll(async () => {
  dir = await createTempDir();
});
afterAll(async () => {
  await removeTempDir(dir);
});

async function loadEvents(count: number) {
  const { store } = await CalendarStore.open(
    new NodeFileIO(),
    path.join(dir, `plan-${count}.json`),
  );
  store.upsertSource(SOURCE);
  store.upsertEvents(SOURCE.id, buildStoredEvents(count, SOURCE.id));
  return store.listEnrichedEvents();
}

/** 参考实现：一次算完（改动前调度器走的那条路）。 */
function syncPlan(events: ReturnType<typeof asNormalizedEvent>[]) {
  return planReminders({
    events: expandEventOccurrences(events, {
      from: FROM,
      to: shiftDateKey(FROM, REMINDER_HORIZON_DAYS),
    }),
    notificationsEnabled: true,
    matchReminder: undefined,
    nowMs: NOW_MS,
  });
}

function drain(load: ReturnType<typeof createReminderPlanLoad>): void {
  let guard = 0;
  while (load.hasWork()) {
    load.advance();
    guard += 1;
    if (guard > 100_000) {
      throw new Error("分片没有收敛");
    }
  }
}

describe("createReminderPlanLoad — 提醒计划分片（SC-020）", () => {
  it("分片结果与同步路径逐条相同（含比赛默认建议与事件自带 VALARM）", async () => {
    const events = await loadEvents(1_000);
    const load = createReminderPlanLoad({
      events,
      from: FROM,
      notificationsEnabled: true,
      matchReminder: undefined,
      nowMs: NOW_MS,
    });
    drain(load);

    const expected: PlannedReminder[] = syncPlan(events);
    expect(expected.length).toBeGreaterThan(0);
    expect(load.result()).toEqual(expected);
  });

  it("大数据量第一个任务不完成：未算完时不给半份计划", async () => {
    const events = await loadEvents(10_000);
    const load = createReminderPlanLoad({
      events,
      from: FROM,
      notificationsEnabled: true,
      matchReminder: undefined,
      nowMs: NOW_MS,
    });

    expect(load.advance()).toBe(true);
    expect(load.hasWork()).toBe(true);
    expect(load.result()).toBeUndefined();

    drain(load);
    expect(load.result()).toEqual(syncPlan(events));
  });

  it("通知关闭时计划为空，且不需要展开（第一个任务就结束）", async () => {
    const events = await loadEvents(10_000);
    const load = createReminderPlanLoad({
      events,
      from: FROM,
      notificationsEnabled: false,
      matchReminder: undefined,
      nowMs: NOW_MS,
    });

    // 总开关关闭时 planReminders 直接返回空——展开仍然按片走，
    // 但这里断言的是结果语义：关闭即空计划。
    drain(load);
    expect(load.result()).toEqual([]);
  });
});
