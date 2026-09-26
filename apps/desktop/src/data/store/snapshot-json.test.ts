// @vitest-environment node
import { describe, expect, it } from "vitest";
import { snapshotJsonInChunks, type SnapshotSections } from "./snapshot-json";
import type { CalendarSource, StoredEvent } from "../model";
import type { EventEnrichment } from "./schema";

/**
 * SC-024：快照 JSON 的分片序列化。
 *
 * 这里钉的是**格式**：分片版本与 `JSON.stringify(snapshot, null, 2)` 必须逐字节
 * 相同（快照是磁盘上的权威副本，格式漂移等于迁移问题）。因此除了用例里手写的
 * 等价对象，calendar-store.test.ts 还会用真实存储把两条路径对照一遍。
 */

function drain(chunkItems: number, sections: SnapshotSections) {
  const steps = snapshotJsonInChunks(sections, chunkItems);
  let yields = 0;
  let step = steps.next();
  while (!step.done) {
    yields += 1;
    step = steps.next();
  }
  return { text: step.value, yields };
}

const SOURCES: CalendarSource[] = [
  { id: "local-ics:个人", type: "local-ics", name: "个人日历", enabled: true },
  {
    id: "webcal:1",
    type: "webcal",
    name: "订阅",
    enabled: false,
    webcal: { url: "https://example.com/feed.ics", etag: 'W/"v1"' },
    lastSyncStatus: "ok",
  },
];

const EVENTS: StoredEvent[] = [
  {
    uid: "a@semantic-calendar",
    sourceId: "local-ics:个人",
    title: '带引号 " 与\\反斜杠\n换行',
    start: "2026-10-18",
    allDay: true,
    normalizedTitle: "全天",
  },
  {
    uid: "b@semantic-calendar",
    sourceId: "webcal:1",
    title: "周会",
    start: "2026-10-19T09:00:00.000Z",
    allDay: false,
    recurrence: { rrule: "FREQ=WEEKLY;COUNT=3", exdates: [] },
    alarms: [{ minutes: 15, direction: "before", related: "start" }],
  },
];

const ENRICHMENTS = new Map<string, EventEnrichment>([
  [
    "webcal:1\u0000b@semantic-calendar\u0000",
    {
      semantic: {
        type: "sport.fixture",
        entities: [{ type: "team", id: "a" }],
      },
    },
  ],
  [
    "local-ics:个人\u0000a@semantic-calendar\u0000",
    { metadata: { display: "badge", rank: 2, flag: false, empty: {} } },
  ],
]);

const SETTINGS = new Map<string, unknown>([
  ["theme", "dark"],
  ["followedTeams", ["arsenal", "liverpool"]],
  ["nested", { deep: { list: [1, "中文", null] } }],
  // 值为 undefined 的键与 JSON.stringify 一致地不输出。
  ["missing", undefined],
  ["emptyList", []],
]);

/** 与 SnapshotSections 等价的普通对象；键顺序与排好序的 Map 一致。 */
function equivalentPlain(): Record<string, unknown> {
  const asRecord = (entries: ReadonlyMap<string, unknown>) =>
    Object.fromEntries(
      [...entries.keys()]
        .sort()
        .filter((key) => entries.get(key) !== undefined)
        .map((key) => [key, entries.get(key)]),
    );
  return {
    schemaVersion: 1,
    sources: SOURCES,
    events: EVENTS,
    enrichments: asRecord(ENRICHMENTS),
    settings: asRecord(SETTINGS),
  };
}

function sections(): SnapshotSections {
  return {
    schemaVersion: 1,
    sources: SOURCES,
    events: EVENTS,
    enrichments: ENRICHMENTS,
    settings: SETTINGS,
  };
}

describe("snapshotJsonInChunks — 分片序列化（SC-024）", () => {
  it("与 JSON.stringify(..., null, 2) 逐字节相同（不同分片粒度下都是同一份文本）", () => {
    const expected = JSON.stringify(equivalentPlain(), null, 2);

    for (const chunkItems of [1, 2, 1000]) {
      const { text } = drain(chunkItems, sections());
      expect(text).toBe(expected);
      // 再确认一次这确实是可解析的 JSON（字节相同也可能两边都坏）。
      expect(JSON.parse(text)).toEqual(JSON.parse(expected));
    }
  });

  it("空分区不展开：空数组与空对象各占一行", () => {
    const empty: SnapshotSections = {
      schemaVersion: 1,
      sources: [],
      events: [],
      enrichments: new Map(),
      settings: new Map(),
    };

    const { text, yields } = drain(1, empty);

    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
    expect(text).toContain('"sources": []');
    expect(text).toContain('"enrichments": {}');
    // 没有项可序列化时不该产生让出点。
    expect(yields).toBe(0);
  });

  it("分片粒度为 0 时中间不让出：一次 next 就结束", () => {
    const steps = snapshotJsonInChunks(sections(), 0);
    const first = steps.next();

    expect(first.done).toBe(true);
    expect(first.value).toBe(JSON.stringify(equivalentPlain(), null, 2));
  });

  it("开启分片后按项让出，且不改变文本", () => {
    const { text, yields } = drain(1, sections());

    // 让出点在项与项之间：来源 2 项让 1 次、事件 2 项 1 次、增强 2 项 1 次、
    // 设置 5 个键 4 次（其中 "missing" 不输出，但边界照旧）。
    expect(yields).toBe(7);
    expect(text).toBe(JSON.stringify(equivalentPlain(), null, 2));
  });
});
