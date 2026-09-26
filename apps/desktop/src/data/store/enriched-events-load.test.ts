// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runYielding } from "../../scheduling/run-yielding";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CalendarSource, RawCalendarEvent } from "../model";
import { CalendarStore } from "./calendar-store";
import { NodeFileIO } from "./node-file-io";
import {
  enrichedEventsInChunks,
  loadEnrichedEvents,
  type EnrichedEventsLoadInput,
} from "./enriched-events-load";

/**
 * SC-024：界面事件集合的分片读取。
 *
 * 被测的是「分片不改变结果」与「读完才发布」：调用方（App）用后一条决定
 * 什么时候换掉界面上的事件集合。
 */

let dataDir: string;
let store: CalendarStore;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "semantic-calendar-events-"));
  const opened = await CalendarStore.open(
    new NodeFileIO(),
    path.join(dataDir, "calendar-store.json"),
  );
  store = opened.store;
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function source(id: string, enabled: boolean): CalendarSource {
  return { id, type: "local-ics", name: id, enabled };
}

function event(uid: string, sourceId: string, start: string): RawCalendarEvent {
  return { uid, sourceId, title: `事件 ${uid}`, start, allDay: false };
}

function seed(): void {
  store.upsertSource(source("source-a", true));
  store.upsertSource(source("source-b", false));
  store.upsertEvents("source-a", [
    event("a1", "source-a", "2026-10-03T09:00:00"),
    event("a2", "source-a", "2026-10-01T09:00:00"),
  ]);
  store.upsertEvents("source-b", [
    event("b1", "source-b", "2026-10-02T09:00:00"),
  ]);
}

function inputWith(): EnrichedEventsLoadInput {
  return { store, enabledSourceIds: new Set(["source-a"]) };
}

describe("分片读取界面事件集合（SC-024）", () => {
  it("同步入口按 start 排序，且停用来源的事件不进结果（SRC-003）", () => {
    seed();

    const events = loadEnrichedEvents(inputWith());

    expect(events.map((item) => item.uid)).toEqual(["a2", "a1"]);
  });

  it("分片结果与同步入口逐条相同（不同粒度下都是同一份集合）", async () => {
    seed();
    const expected = loadEnrichedEvents(inputWith());

    for (const chunkEvents of [1, 2, 1000]) {
      await expect(
        runYielding(enrichedEventsInChunks(inputWith(), chunkEvents)),
      ).resolves.toEqual(expected);
    }
  });

  it("读完之前拿不到结果：让出发生在结果产生之前", async () => {
    seed();
    const steps = enrichedEventsInChunks(inputWith(), 1);
    // 粒度 1：第一个任务只处理一条事件，因此远未读完。
    expect(steps.next().done).toBe(false);

    let step = steps.next();
    while (!step.done) {
      step = steps.next();
    }
    expect(step.value).toHaveLength(2);
  });

  it("启用集合为空时结果是空集合（不是不过滤）", () => {
    seed();

    expect(loadEnrichedEvents({ store, enabledSourceIds: new Set() })).toEqual(
      [],
    );
  });
});
