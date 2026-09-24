// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CalendarSource, RawCalendarEvent, SemanticEvent } from "../model";
import { eventKey } from "../model";
import { CalendarStore } from "./calendar-store";
import { NodeFileIO } from "./node-file-io";
import { CURRENT_SCHEMA_VERSION } from "./schema";

const STORE_FILE = "calendar-store.json";

let dataDir: string;
let storePath: string;
let fileIO: NodeFileIO;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "semantic-calendar-store-"));
  storePath = path.join(dataDir, STORE_FILE);
  fileIO = new NodeFileIO();
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function makeSource(overrides: Partial<CalendarSource> = {}): CalendarSource {
  return {
    id: "source-1",
    type: "local-ics",
    name: "个人日历",
    enabled: true,
    ...overrides,
  };
}

function makeEvent(
  overrides: Partial<RawCalendarEvent> = {},
): RawCalendarEvent {
  return {
    uid: "event-1@semantic-calendar",
    sourceId: "source-1",
    title: "Arsenal vs Manchester City",
    start: "2026-10-18T16:30:00.000Z",
    end: "2026-10-18T18:30:00.000Z",
    allDay: false,
    rawPayload: "BEGIN:VEVENT\nSUMMARY:Arsenal vs Manchester City\nEND:VEVENT",
    ...overrides,
  };
}

const fixtureSemantic: SemanticEvent = {
  type: "sport.fixture",
  entities: [
    { type: "team", id: "arsenal" },
    { type: "team", id: "manchester-city" },
  ],
  confidence: 0.92,
  matcherId: "football/premier-league-title",
};

describe("CalendarStore.open", () => {
  it("首次打开时创建空的 v1 快照", async () => {
    const { store, recovery } = await CalendarStore.open(fileIO, storePath);

    expect(recovery).toBeUndefined();
    expect(store.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(store.listSources()).toEqual([]);
    expect(store.listEvents()).toEqual([]);
    expect(store.getSetting("theme")).toBeUndefined();
  });

  it("保存后在磁盘上留下带 schema 版本的快照", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    await store.save();

    const onDisk = JSON.parse(await readFile(storePath, "utf8"));
    expect(onDisk.schemaVersion).toBe(1);
    expect(onDisk.sources).toEqual([]);
    expect(onDisk.events).toEqual([]);
  });

  it("保存不留临时文件（原子写完成）", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    await store.save();

    const files = await readdir(dataDir);
    expect(files).toEqual([STORE_FILE]);
  });
});

describe("重启后数据仍存在", () => {
  it("重新打开能读回来源、事件、增强结果与设置", async () => {
    const first = await CalendarStore.open(fileIO, storePath);
    first.store.upsertSource(makeSource());
    first.store.updateSourceStatus("source-1", {
      lastSyncStatus: "ok",
      lastSyncAt: "2026-09-23T08:00:00.000Z",
    });
    first.store.upsertEvents("source-1", [makeEvent()]);
    first.store.saveEnrichment(
      {
        sourceId: "source-1",
        uid: "event-1@semantic-calendar",
      },
      { semantic: fixtureSemantic },
    );
    first.store.setSetting("theme", "dark");
    await first.store.save();

    const second = await CalendarStore.open(fileIO, storePath);
    expect(second.store.listSources()).toMatchObject([
      {
        id: "source-1",
        lastSyncStatus: "ok",
        lastSyncAt: "2026-09-23T08:00:00.000Z",
      },
    ]);
    expect(second.store.listEvents()).toHaveLength(1);
    expect(
      second.store.getEnrichment({
        sourceId: "source-1",
        uid: "event-1@semantic-calendar",
      }),
    ).toMatchObject({ semantic: { type: "sport.fixture" } });
    expect(second.store.getSetting("theme")).toBe("dark");
  });
});

describe("事件去重（ICS-001）", () => {
  it("同来源同 UID 重复导入被合并而不是重复插入", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource());

    const first = store.upsertEvents("source-1", [makeEvent()]);
    expect(first).toEqual({ inserted: 1, updated: 0 });

    const second = store.upsertEvents("source-1", [
      makeEvent({ title: "Arsenal vs Manchester City (Updated)" }),
    ]);
    expect(second).toEqual({ inserted: 0, updated: 1 });

    const events = store.listEvents();
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Arsenal vs Manchester City (Updated)");
  });

  it("不同 occurrenceId 视为不同实例", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource());

    store.upsertEvents("source-1", [
      makeEvent(),
      makeEvent({ occurrenceId: "20261018T160000Z" }),
    ]);

    expect(store.listEvents()).toHaveLength(2);
  });

  it("不同来源的相同 UID 互不影响", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource({ id: "source-a" }));
    store.upsertSource(makeSource({ id: "source-b" }));

    store.upsertEvents("source-a", [makeEvent()]);
    store.upsertEvents("source-b", [makeEvent()]);

    expect(store.listEvents()).toHaveLength(2);
  });

  it("upsert 时强制使用调用方声明的 sourceId", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource());

    store.upsertEvents("source-1", [
      makeEvent({ sourceId: "来自其它来源的字段" }),
    ]);

    expect(store.listEvents()[0].sourceId).toBe("source-1");
  });
});

describe("数据源状态持久化（SRC-003）", () => {
  it("updateSourceStatus 记录刷新结果", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource({ lastSyncStatus: "never" }));

    store.updateSourceStatus("source-1", {
      lastSyncStatus: "error",
      lastSyncError: "HTTP 503",
      lastSyncAt: "2026-09-23T09:00:00.000Z",
    });

    expect(store.listSources()[0]).toMatchObject({
      lastSyncStatus: "error",
      lastSyncError: "HTTP 503",
    });
  });

  it("removeSource 级联删除其事件与增强结果", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource());
    store.upsertSource(makeSource({ id: "source-2" }));
    store.upsertEvents("source-1", [makeEvent()]);
    store.upsertEvents("source-2", [
      makeEvent({ uid: "event-2@semantic-calendar" }),
    ]);
    store.saveEnrichment(
      { sourceId: "source-1", uid: "event-1@semantic-calendar" },
      { semantic: fixtureSemantic },
    );

    store.removeSource("source-1");

    expect(store.listSources().map((s) => s.id)).toEqual(["source-2"]);
    expect(store.listEvents().map((e) => e.sourceId)).toEqual(["source-2"]);
    expect(
      store.getEnrichment({
        sourceId: "source-1",
        uid: "event-1@semantic-calendar",
      }),
    ).toBeUndefined();
  });

  it("replaceSourceEvents 用新批次整体替换旧事件", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource());
    store.upsertEvents("source-1", [
      makeEvent(),
      makeEvent({ uid: "old-event@semantic-calendar" }),
    ]);

    store.replaceSourceEvents("source-1", [
      makeEvent({ uid: "new-event@semantic-calendar" }),
    ]);

    expect(store.listEvents().map((e) => e.uid)).toEqual([
      "new-event@semantic-calendar",
    ]);
  });
});

describe("WebCal 订阅状态与缓存（SC-007 / SRC-003 / SRC-004）", () => {
  it("setSourceEnabled 切换启用状态并落盘", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource({ type: "webcal" }));

    expect(store.setSourceEnabled("source-1", false)).toBe(true);
    await store.save();

    const onDisk = JSON.parse(await readFile(storePath, "utf8"));
    expect(onDisk.sources[0].enabled).toBe(false);
  });

  it("未知来源的启用 / 缓存写入被拒绝，而不是新建来源", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);

    expect(store.setSourceEnabled("missing", false)).toBe(false);
    expect(
      store.setSourceCache("missing", { url: "https://example.com/a.ics" }),
    ).toBe(false);
    expect(store.listSources()).toEqual([]);
  });

  it("setSourceCache 整体替换缓存元数据，可清掉过期校验值", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource({ type: "webcal" }));

    store.setSourceCache("source-1", {
      url: "https://example.com/a.ics",
      etag: 'W/"v1"',
      lastModified: "Wed, 21 Oct 2026 07:28:00 GMT",
      lastCheckedAt: "2026-10-21T08:00:00.000Z",
    });
    store.setSourceCache("source-1", {
      url: "https://example.com/a.ics",
      etag: undefined,
      lastModified: undefined,
      lastCheckedAt: "2026-10-21T09:00:00.000Z",
    });
    await store.save();

    const onDisk = JSON.parse(await readFile(storePath, "utf8"));
    expect(onDisk.sources[0].webcal).toEqual({
      url: "https://example.com/a.ics",
      lastCheckedAt: "2026-10-21T09:00:00.000Z",
    });
  });

  it("刷新失败时保留上次成功时间与旧事件（SRC-004）", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource({ type: "webcal" }));
    store.upsertEvents("source-1", [makeEvent()]);
    store.updateSourceStatus("source-1", {
      lastSyncStatus: "ok",
      lastSyncAt: "2026-10-21T08:00:00.000Z",
    });
    store.updateSourceStatus("source-1", {
      lastSyncStatus: "error",
      lastSyncError: "网络请求失败",
    });

    const [source] = store.listSources();
    expect(source.lastSyncStatus).toBe("error");
    expect(source.lastSyncError).toBe("网络请求失败");
    expect(source.lastSyncAt).toBe("2026-10-21T08:00:00.000Z");
    expect(store.listEvents("source-1")).toHaveLength(1);
  });
});

describe("并发落盘（SC-007：刷新与手动操作可能同时写）", () => {
  it("重叠的 save 串行写入，最后一次写入反映最新状态", async () => {
    const writes: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const slowFileIO = {
      async readFile() {
        return null;
      },
      async writeFile(_path: string, contents: string) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        writes.push(contents);
        inFlight -= 1;
      },
      async renameFile() {},
    };

    const { store } = await CalendarStore.open(slowFileIO, storePath);
    store.setSetting("k", 1);
    const first = store.save();
    store.setSetting("k", 2);
    const second = store.save();

    await Promise.all([first, second]);

    expect(maxInFlight).toBe(1);
    expect(writes).toHaveLength(2);
    // 第二次 save 的快照在队列内序列化，因此包含最新值。
    expect(JSON.parse(writes[1]).settings.k).toBe(2);
  });

  it("一次 save 失败不影响后续 save", async () => {
    const writes: string[] = [];
    let failNext = true;
    const flakyFileIO = {
      async readFile() {
        return null;
      },
      async writeFile(_path: string, contents: string) {
        if (failNext) {
          failNext = false;
          throw new Error("磁盘不可写");
        }
        writes.push(contents);
      },
      async renameFile() {},
    };

    const { store } = await CalendarStore.open(flakyFileIO, storePath);
    await expect(store.save()).rejects.toThrow("磁盘不可写");
    await expect(store.save()).resolves.toBeUndefined();
    expect(writes).toHaveLength(1);
  });
});

describe("原始数据与增强数据分离（SEM-004）", () => {
  it("清除增强结果不影响原始事件，可重新匹配", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource());
    store.upsertEvents("source-1", [makeEvent()]);
    store.saveEnrichment(
      { sourceId: "source-1", uid: "event-1@semantic-calendar" },
      { semantic: fixtureSemantic },
    );

    store.clearEnrichments();

    expect(store.listEvents()).toHaveLength(1);
    expect(
      store.getEnrichment({
        sourceId: "source-1",
        uid: "event-1@semantic-calendar",
      }),
    ).toBeUndefined();
  });

  it("listEnrichedEvents 连接语义并保留原始字段", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource());
    store.upsertEvents("source-1", [makeEvent()]);
    store.saveEnrichment(
      { sourceId: "source-1", uid: "event-1@semantic-calendar" },
      {
        semantic: fixtureSemantic,
        metadata: { display: "badge" },
      },
    );

    const enriched = store.listEnrichedEvents();
    expect(enriched).toHaveLength(1);
    expect(enriched[0].semantic).toEqual(fixtureSemantic);
    expect(enriched[0].metadata).toEqual({ display: "badge" });
    expect(enriched[0].rawPayload).toContain("BEGIN:VEVENT");
  });

  it("未标准化的事件回退原标题作为 normalizedTitle", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource());
    store.upsertEvents("source-1", [makeEvent()]);

    const enriched = store.listEnrichedEvents();
    expect(enriched[0].normalizedTitle).toBe("Arsenal vs Manchester City");
  });
});

describe("设置", () => {
  it("getSetting 支持默认值", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    expect(store.getSetting("theme", "light")).toBe("light");
    store.setSetting("theme", "dark");
    expect(store.getSetting("theme", "light")).toBe("dark");
  });
});

describe("异常恢复（app-spec §11）", () => {
  it("损坏的 JSON 被隔离并从空快照恢复", async () => {
    await writeFile(storePath, "{ not valid json", "utf8");

    const { store, recovery } = await CalendarStore.open(fileIO, storePath);

    expect(store.listSources()).toEqual([]);
    expect(recovery?.reason).toBe("corrupt-json");
    const files = await readdir(dataDir);
    const quarantined = files.find((f) =>
      f.startsWith(`${STORE_FILE}.corrupt-`),
    );
    expect(quarantined).toBeDefined();
    expect(recovery?.quarantinedTo).toBe(path.join(dataDir, quarantined!));
  });

  it("结构非法的快照被隔离", async () => {
    await writeFile(
      storePath,
      JSON.stringify({ schemaVersion: 1, sources: "not-an-array" }),
      "utf8",
    );

    const { store, recovery } = await CalendarStore.open(fileIO, storePath);

    expect(store.listEvents()).toEqual([]);
    expect(recovery?.reason).toBe("invalid-shape");
  });

  it("未来 schema 版本被隔离而不是被旧版本误读", async () => {
    await writeFile(
      storePath,
      JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION + 5 }),
      "utf8",
    );

    const { store, recovery } = await CalendarStore.open(fileIO, storePath);

    expect(store.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(recovery?.reason).toBe("future-version");
  });

  // NaN 无法通过 JSON 序列化存在（会变成 null，走 legacy 迁移路径），不在用例内。
  it.each([0.5, -1])(
    "非法版本号 %s 被隔离而不是被误读",
    async (schemaVersion) => {
      await writeFile(storePath, JSON.stringify({ schemaVersion }), "utf8");

      const { store, recovery } = await CalendarStore.open(fileIO, storePath);

      expect(store.listEvents()).toEqual([]);
      expect(recovery?.reason).toBe("invalid-shape");
    },
  );
});

describe("schema migration", () => {
  it("缺失 schemaVersion 的历史快照迁移到当前版本并保留数据", async () => {
    const legacy = {
      sources: [makeSource()],
      events: [makeEvent()],
      settings: { theme: "dark" },
    };
    await writeFile(storePath, JSON.stringify(legacy), "utf8");

    const { store, recovery } = await CalendarStore.open(fileIO, storePath);

    expect(recovery).toBeUndefined();
    expect(store.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(store.listSources()).toHaveLength(1);
    expect(store.listEvents()).toHaveLength(1);
    expect(store.getSetting("theme")).toBe("dark");
  });

  it("迁移后的快照按当前 schema 落盘", async () => {
    await writeFile(
      storePath,
      JSON.stringify({ sources: [], events: [] }),
      "utf8",
    );
    const { store } = await CalendarStore.open(fileIO, storePath);
    await store.save();

    const onDisk = JSON.parse(await readFile(storePath, "utf8"));
    expect(onDisk.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(onDisk.enrichments).toEqual({});
  });
});

describe("eventKey", () => {
  it("来源、UID、occurrence 共同构成持久化键", () => {
    expect(eventKey({ sourceId: "s", uid: "u", occurrenceId: "o" })).not.toBe(
      eventKey({ sourceId: "s", uid: "u" }),
    );
    expect(eventKey({ sourceId: "s", uid: "u" })).not.toBe(
      eventKey({ sourceId: "s2", uid: "u" }),
    );
  });
});
