// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asNormalizedEvent, eventKey } from "../data/model";
import { importLocalIcs } from "../data/import/import-local-ics";
import { CalendarStore } from "../data/store/calendar-store";
import { NodeFileIO } from "../data/store/node-file-io";
import { createMatcherEngine, type EventMatcher } from "./matcher-engine";
import {
  createBuiltinTypeMetadataResolver,
  createMetadataResolver,
} from "./metadata-resolver";
import { reEnrichStore } from "./enrich";

let dataDir: string;
let storePath: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "semantic-calendar-enrich-"));
  storePath = path.join(dataDir, "calendar-store.json");
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

async function openStore() {
  return (await CalendarStore.open(new NodeFileIO(), storePath)).store;
}

/** 标题精确匹配的测试 Matcher。 */
function titleMatcher(
  id: string,
  title: string,
  type: "holiday" | "sport.fixture",
): EventMatcher {
  return {
    id,
    priority: 10,
    match: (event) =>
      event.normalizedTitle === title
        ? {
            type,
            confidence: 1,
            reason: `${id}: 标题精确命中`,
          }
        : null,
  };
}

const RESOLVER = createMetadataResolver([createBuiltinTypeMetadataResolver()]);

async function seedStore(): Promise<CalendarStore> {
  const store = await openStore();
  store.upsertSource({
    id: "src-1",
    type: "local-ics",
    name: "测试源",
    enabled: true,
  });
  store.upsertEvents("src-1", [
    {
      uid: "holiday-1",
      sourceId: "src-1",
      title: "国庆假期",
      normalizedTitle: "国庆假期",
      start: "2026-10-01",
      allDay: true,
    },
    {
      uid: "plain-1",
      sourceId: "src-1",
      title: "每周站会",
      normalizedTitle: "每周站会",
      start: "2026-10-07T09:00:00",
      allDay: false,
    },
  ]);
  return store;
}

describe("增强管线（SC-009 / SEM-003 / SEM-004）", () => {
  it("命中事件写入 semantic + metadata；原始事件分毫未动", async () => {
    const store = await seedStore();
    const before = store.listEvents();
    const engine = createMatcherEngine([
      titleMatcher("cn", "国庆假期", "holiday"),
    ]);

    const stats = reEnrichStore(store, { engine, resolver: RESOLVER });

    expect(stats).toEqual({ matched: 1, unmatched: 1 });
    // 原始数据不被覆盖：事件列表与增强前逐字段一致。
    expect(store.listEvents()).toEqual(before);

    const enriched = store.listEnrichedEvents();
    const holiday = enriched.find((event) => event.uid === "holiday-1");
    expect(holiday?.semantic).toMatchObject({
      type: "holiday",
      matcherId: "cn",
    });
    expect(holiday?.metadata).toMatchObject({
      accent: "var(--semantic-holiday)",
      label: "法定节假日",
    });
  });

  it("未命中事件不写增强记录，按普通事件读取（SEM-003）", async () => {
    const store = await seedStore();
    reEnrichStore(store, {
      engine: createMatcherEngine([titleMatcher("cn", "国庆假期", "holiday")]),
      resolver: RESOLVER,
    });

    const plain = store
      .listEnrichedEvents()
      .find((event) => event.uid === "plain-1");
    expect(plain?.semantic).toBeUndefined();
    expect(plain?.metadata).toBeUndefined();
    // 快照中也没有它的增强记录。
    expect(Object.keys(store.toSnapshot().enrichments)).toEqual([
      eventKey({ sourceId: "src-1", uid: "holiday-1" }),
    ]);
  });

  it("Matcher 更新后重算：语义被替换且无需重新导入（SEM-004）", async () => {
    const store = await seedStore();
    reEnrichStore(store, {
      engine: createMatcherEngine([
        titleMatcher("v1-holiday", "国庆假期", "holiday"),
      ]),
      resolver: RESOLVER,
    });
    expect(
      store.getEnrichment({ sourceId: "src-1", uid: "holiday-1" })?.semantic
        ?.matcherId,
    ).toBe("v1-holiday");

    // 换新 Matcher 集合（版本升级场景），同一个入口重建。
    const stats = reEnrichStore(store, {
      engine: createMatcherEngine([
        titleMatcher("v2-holiday", "国庆假期", "holiday"),
        titleMatcher("v2-sport", "每周站会", "sport.fixture"),
      ]),
      resolver: RESOLVER,
    });

    expect(stats).toEqual({ matched: 2, unmatched: 0 });
    const holiday = store.getEnrichment({
      sourceId: "src-1",
      uid: "holiday-1",
    });
    expect(holiday?.semantic?.matcherId).toBe("v2-holiday");
    // 新 Matcher 识别出的事件获得对应展示元数据。
    const standup = store.getEnrichment({ sourceId: "src-1", uid: "plain-1" });
    expect(standup?.semantic?.type).toBe("sport.fixture");
    expect(standup?.metadata).toMatchObject({ label: "体育赛事" });
    // 原始事件始终未被动过。
    expect(
      store
        .listEvents()
        .map((event) => event.uid)
        .sort(),
    ).toEqual(["holiday-1", "plain-1"]);
  });

  it("重建清除过期增强：不再命中的记录不会残留", async () => {
    const store = await seedStore();
    // 手工写入一条孤儿增强（模拟旧版本 Matcher 的产物）。
    store.saveEnrichment(
      { sourceId: "src-1", uid: "plain-1" },
      { semantic: { type: "festival", matcherId: "old" } },
    );

    reEnrichStore(store, {
      engine: createMatcherEngine([titleMatcher("cn", "国庆假期", "holiday")]),
      resolver: RESOLVER,
    });

    expect(
      store.getEnrichment({ sourceId: "src-1", uid: "plain-1" }),
    ).toBeUndefined();
    expect(Object.keys(store.toSnapshot().enrichments)).toEqual([
      eventKey({ sourceId: "src-1", uid: "holiday-1" }),
    ]);
  });

  it("无 Matcher 时等价于清空增强：事件全部按普通事件显示", async () => {
    const store = await seedStore();
    const stats = reEnrichStore(store, {
      engine: createMatcherEngine([]),
      resolver: RESOLVER,
    });
    expect(stats).toEqual({ matched: 0, unmatched: 2 });
    expect(store.toSnapshot().enrichments).toEqual({});
  });

  it("集成：ICS 导入 → 标准化标题 → Matcher 识别（真实链路）", async () => {
    const store = await openStore();
    await importLocalIcs(store, {
      fileName: "mixed.ics",
      contents: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:pl-match@example.com",
        "SUMMARY:　Ａｒｓｅｎａｌ　ｖｓ　Ｍａｎｃｈｅｓｔｅｒ　Ｃｉｔｙ　",
        "DTSTART;TZID=Europe/London:20261018T130000",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    });

    // Matcher 消费的是 SC-008 标准化后的标题（全角 → 半角、去首尾空格）。
    const footballMatcher: EventMatcher = {
      id: "football-v0",
      priority: 10,
      match: (event) =>
        /arsenal\s+vs\s+manchester\s+city/i.test(event.normalizedTitle)
          ? {
              type: "sport.fixture",
              subtype: "premier-league",
              entities: [
                { type: "team", id: "arsenal" },
                { type: "team", id: "manchester-city" },
              ],
              confidence: 0.95,
            }
          : null,
    };
    const stats = reEnrichStore(store, {
      engine: createMatcherEngine([footballMatcher]),
      resolver: RESOLVER,
    });

    expect(stats).toEqual({ matched: 1, unmatched: 0 });
    const enriched = store.listEnrichedEvents()[0];
    expect(enriched.semantic).toEqual({
      type: "sport.fixture",
      subtype: "premier-league",
      entities: [
        { type: "team", id: "arsenal" },
        { type: "team", id: "manchester-city" },
      ],
      confidence: 0.95,
      matcherId: "football-v0",
    });
    expect(enriched.metadata).toMatchObject({
      accent: "var(--semantic-sport)",
    });
    // 原始标题保留，未被标准化或匹配改写。
    expect(enriched.title).toBe(
      "　Ａｒｓｅｎａｌ　ｖｓ　Ｍａｎｃｈｅｓｔｅｒ　Ｃｉｔｙ　",
    );
    expect(asNormalizedEvent(store.listEvents()[0]).normalizedTitle).toBe(
      "Arsenal vs Manchester City",
    );
  });
});
