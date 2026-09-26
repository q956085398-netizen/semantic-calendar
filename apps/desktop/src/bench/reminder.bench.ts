// @vitest-environment node
/**
 * 基线：提醒计划（SC-017 / app-spec §15「通知时间」与「大量事件不阻塞 UI」）。
 *
 * 提醒计划的输入是「当前日期起 30 天」窗口里展开好的 occurrence；展开与月切换
 * 共用同一个函数，只是窗口更长。两段分开测，才能看出主线程上真正花掉的时间
 * 在哪一段——展开是纯计算，计划本身还要按提醒策略逐条判时间。
 */

import path from "node:path";
import { afterAll, beforeAll, bench, describe } from "vitest";
import { shiftDayKey } from "../calendar/date-keys";
import type { CalendarSource, EnrichedEvent } from "../data/model";
import { CalendarStore } from "../data/store/calendar-store";
import { NodeFileIO } from "../data/store/node-file-io";
import {
  REMINDER_HORIZON_DAYS,
  planReminders,
} from "../notifications/reminder-plan";
import { expandEventOccurrences } from "../normalize/occurrences";
import { EVENT_COUNTS, buildStoredEvents } from "./fixtures";
import { createTempDir, removeTempDir } from "./support";

const SOURCE: CalendarSource = {
  id: "local-ics:perf",
  type: "local-ics",
  name: "perf.ics",
  enabled: true,
};

/** 固定“现在”与窗口起点：计划结果与运行时刻无关，重复运行可比。 */
const FROM = "2026-10-01";
const NOW_MS = Date.parse("2026-10-01T09:00:00.000Z");
const WINDOW = { from: FROM, to: shiftDayKey(FROM, REMINDER_HORIZON_DAYS) };

let dir = "";
beforeAll(async () => {
  dir = await createTempDir();
});
afterAll(async () => {
  await removeTempDir(dir);
});

const visibleEvents = new Map<number, EnrichedEvent[]>();
const occurrencesByCount = new Map<number, EnrichedEvent[]>();

beforeAll(async () => {
  for (const count of EVENT_COUNTS) {
    const { store } = await CalendarStore.open(
      new NodeFileIO(),
      path.join(dir, `reminder-${count}.json`),
    );
    store.upsertSource(SOURCE);
    store.upsertEvents(SOURCE.id, buildStoredEvents(count, SOURCE.id));
    visibleEvents.set(count, store.listEnrichedEvents());
  }
});

beforeAll(() => {
  for (const count of EVENT_COUNTS) {
    occurrencesByCount.set(
      count,
      expandEventOccurrences(visibleEvents.get(count) ?? [], WINDOW),
    );
  }
});

describe("提醒 · 展开 30 天窗口（与月切换同一函数）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `${count} 条事件`,
      () => {
        expandEventOccurrences(visibleEvents.get(count) ?? [], WINDOW);
      },
      { iterations: 5, warmupIterations: 1, time: 0 },
    );
  }
});

describe("提醒 · 计划（展开后的 occurrence → 提醒列表）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `${count} 条事件的 occurrence`,
      () => {
        planReminders({
          events: occurrencesByCount.get(count) ?? [],
          notificationsEnabled: true,
          matchReminder: undefined,
          nowMs: NOW_MS,
        });
      },
      { iterations: 5, warmupIterations: 1, time: 0 },
    );
  }
});
