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

  it("replaceSourceEvents 删掉消失事件的增强记录，重新入库的那份等待重建", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource());
    const kept = makeEvent();
    const gone = makeEvent({ uid: "gone-event@semantic-calendar" });
    store.upsertEvents("source-1", [kept, gone]);
    for (const uid of [
      "event-1@semantic-calendar",
      "gone-event@semantic-calendar",
    ]) {
      store.saveEnrichment(
        { sourceId: "source-1", uid },
        {
          semantic: fixtureSemantic,
        },
      );
    }

    // 全量刷新：服务端只剩其中一个 UID，内容原样。
    const result = store.replaceSourceEvents("source-1", [kept]);

    expect(result).toEqual({ inserted: 0, updated: 1, removed: 1 });
    expect(
      store.getEnrichment({
        sourceId: "source-1",
        uid: "gone-event@semantic-calendar",
      }),
    ).toBeUndefined();
    // 刷新批次里的记录一律按“内容可能已变”处理，旧增强结果失效，
    // 由刷新后的重建恢复（SC-007 → SEM-004），因此不会留下过期语义。
    expect(
      store.getEnrichment({
        sourceId: "source-1",
        uid: "event-1@semantic-calendar",
      }),
    ).toBeUndefined();
    // 事件记录本身保持同一个持久化身份：刷新不产生副本。
    expect(store.listEvents().map((e) => e.uid)).toEqual([
      "event-1@semantic-calendar",
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

/**
 * SC-019：快照是本地 JSON 文件，可能被手工编辑或同步工具改坏。
 * 一条读不出来的记录只隔离自己，不带崩整个数据层。
 */
describe("坏记录隔离（SC-019 / app-spec §13）", () => {
  function snapshotWith(records: {
    sources?: unknown[];
    events?: unknown[];
  }): string {
    return JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      sources: records.sources ?? [],
      events: records.events ?? [],
      enrichments: {},
      settings: {},
    });
  }

  it("事件缺必需字段时被丢弃，其余事件照常读出", async () => {
    await writeFile(
      storePath,
      snapshotWith({
        sources: [makeSource()],
        events: [
          // start 缺失：月格展开会在这里炸掉。
          { uid: "bad-1", sourceId: "source-1", title: "坏", allDay: false },
          // allDay 类型不对。
          { ...makeEvent(), uid: "bad-2", allDay: "yes" },
          makeEvent(),
        ],
      }),
      "utf8",
    );

    const { store, dropped } = await CalendarStore.open(fileIO, storePath);

    expect(dropped).toEqual({ events: 2, sources: 0 });
    expect(store.listEvents().map((event) => event.uid)).toEqual([
      "event-1@semantic-calendar",
    ]);
  });

  it("可选字段类型不对时只丢该字段，事件照常显示", async () => {
    await writeFile(
      storePath,
      snapshotWith({
        sources: [makeSource()],
        events: [
          {
            ...makeEvent(),
            description: 42,
            location: { name: "球场" },
            // EXDATE 里混进坏条目：好条目保留，坏条目丢弃。
            recurrence: {
              rrule: "FREQ=WEEKLY;COUNT=3",
              exdates: [{ value: "20261004T163000Z" }, { value: 7 }],
            },
            alarms: [
              { minutes: 30, direction: "before", related: "start" },
              { minutes: -5, direction: "before", related: "start" },
              { minutes: 10, direction: "sideways", related: "start" },
            ],
          },
        ],
      }),
      "utf8",
    );

    const [event] = (
      await CalendarStore.open(fileIO, storePath)
    ).store.listEvents();

    expect(event.description).toBeUndefined();
    expect(event.location).toBeUndefined();
    expect(event.recurrence).toEqual({
      rrule: "FREQ=WEEKLY;COUNT=3",
      exdates: [{ value: "20261004T163000Z" }],
    });
    expect(event.alarms).toEqual([
      { minutes: 30, direction: "before", related: "start" },
    ]);
    expect(event.title).toBe("Arsenal vs Manchester City");
  });

  it("来源读不出来时整条丢弃并报数，事件保留（不删用户数据）", async () => {
    await writeFile(
      storePath,
      snapshotWith({
        sources: [
          makeSource(),
          { name: "没有 id", type: "local-ics", enabled: true },
          makeSource({ id: "source-2", type: "webcal", webcal: undefined }),
        ],
        events: [
          makeEvent(),
          makeEvent({ uid: "event-2", sourceId: "source-2" }),
        ],
      }),
      "utf8",
    );

    const { store, dropped } = await CalendarStore.open(fileIO, storePath);

    // 缺 webcal 缓存的订阅来源同样读不出来：没有地址就没有可刷新的事实。
    expect(dropped).toEqual({ events: 0, sources: 2 });
    expect(store.listSources().map((source) => source.id)).toEqual([
      "source-1",
    ]);
    expect(store.listEvents()).toHaveLength(2);
  });

  it("落盘只写回读得出来的记录，坏记录不会一直留在文件里", async () => {
    await writeFile(
      storePath,
      snapshotWith({
        sources: [makeSource(), { name: "坏来源" }],
        events: [
          { uid: "bad", sourceId: "source-1", title: "坏" },
          makeEvent(),
        ],
      }),
      "utf8",
    );

    const { store } = await CalendarStore.open(fileIO, storePath);
    await store.save();

    const onDisk = JSON.parse(await readFile(storePath, "utf8"));
    expect(onDisk.sources).toHaveLength(1);
    expect(onDisk.events).toHaveLength(1);
  });

  it("被隔离的记录另存为备份文件，原文不因落盘消失", async () => {
    await writeFile(
      storePath,
      snapshotWith({
        sources: [{ name: "坏来源", type: "local-ics" }],
        events: [{ uid: "bad", sourceId: "source-1", title: "坏事件" }],
      }),
      "utf8",
    );

    const { dropped } = await CalendarStore.open(fileIO, storePath);
    expect(dropped).toEqual({ events: 1, sources: 1 });

    // 与整份快照损坏时的 .corrupt- 同一口径：原文留在磁盘上供人工检查。
    const files = await readdir(dataDir);
    const backup = files.find((f) => f.startsWith(`${STORE_FILE}.rejected-`));
    expect(backup).toBeDefined();
    const rejected = JSON.parse(
      await readFile(path.join(dataDir, backup!), "utf8"),
    );
    expect(rejected.rejectedAt).toEqual(expect.any(String));
    expect(rejected.records).toEqual([
      { name: "坏来源", type: "local-ics" },
      { uid: "bad", sourceId: "source-1", title: "坏事件" },
    ]);
  });

  it("全部合法时不给 dropped（调用方不必判断“0 条被丢弃”）", async () => {
    const { dropped } = await CalendarStore.open(fileIO, storePath);

    expect(dropped).toBeUndefined();
    // 没有坏记录就没有备份文件（不给每次启动留下空文件）。
    expect(await readdir(dataDir)).toEqual([]);
  });
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

describe("可见事件集合的版本号（SC-020）", () => {
  it("只在事件集合真的会变时推进：来源状态与校验值不动它", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource());
    expect(store.eventsRevision()).toBe(0);

    // 304 刷新与失败刷新的写入路径：来源状态 / 校验值变了，事件没变。
    store.updateSourceStatus("source-1", {
      lastSyncStatus: "ok",
      lastSyncAt: "2026-09-25T10:00:00.000Z",
    });
    store.setSourceCache("source-1", {
      url: "https://example.com/feed.ics",
      etag: 'W/"v1"',
      lastCheckedAt: "2026-09-25T10:00:00.000Z",
    });
    expect(store.eventsRevision()).toBe(0);

    store.upsertEvents("source-1", [makeEvent()]);
    expect(store.eventsRevision()).toBe(1);

    // 启停会改变“哪些事件进入界面”（SRC-003），因此算一次变化；
    // 重复设置同一个值不算。
    store.setSourceEnabled("source-1", false);
    expect(store.eventsRevision()).toBe(2);
    store.setSourceEnabled("source-1", false);
    expect(store.eventsRevision()).toBe(2);

    store.removeEvents("source-1");
    expect(store.eventsRevision()).toBe(3);
    // 已经没有可删的事件：不再推进。
    store.removeEvents("source-1");
    expect(store.eventsRevision()).toBe(3);
  });

  it("差集替换删掉消失事件时推进（WebCal 200 刷新）", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource());
    store.upsertEvents("source-1", [
      makeEvent(),
      makeEvent({ uid: "event-2@semantic-calendar" }),
    ]);
    const before = store.eventsRevision();

    store.replaceSourceEvents("source-1", [makeEvent()]);

    expect(store.eventsRevision()).toBeGreaterThan(before);
    expect(store.listEvents("source-1")).toHaveLength(1);
  });

  it("新实例从 0 开始：读取方会保守地重读一次", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource());
    store.upsertEvents("source-1", [makeEvent()]);
    await store.save();

    const { store: reopened } = await CalendarStore.open(fileIO, storePath);
    expect(reopened.eventsRevision()).toBe(0);
    expect(reopened.listEvents()).toHaveLength(1);
  });
});

/**
 * SC-024：落库 / 替换 / 读取模型 / 快照序列化的分片版本。
 *
 * 两件事被测：分片不改变结果（对照同步入口逐条比较），以及分片特有的
 * 风险——让出主线程后读取方可能读到半份集合，此时版本号必须能区分
 * 「半份」与「算完」。
 */
describe("分片落库、读取与序列化（SC-024）", () => {
  /** 覆盖插入 / 更新 / 多来源 / 排序：40 条够跨越任意小粒度。 */
  function seededEvents(): RawCalendarEvent[] {
    const events: RawCalendarEvent[] = [];
    for (let index = 0; index < 40; index += 1) {
      events.push(
        makeEvent({
          uid: `event-${index}@semantic-calendar`,
          title: `事件 ${index}`,
        }),
      );
    }
    return events;
  }

  /** 把生成器排空，返回结果与让出次数。 */
  function drain<T>(steps: Generator<void, T, void>): {
    result: T;
    yields: number;
  } {
    let yields = 0;
    let step = steps.next();
    while (!step.done) {
      yields += 1;
      step = steps.next();
    }
    return { result: step.value, yields };
  }

  it("upsertEventsInChunks 与同步入口逐条相同（不同粒度下都是同一份结果）", async () => {
    const sync = await CalendarStore.open(fileIO, storePath);
    sync.store.upsertSource(makeSource());

    const expected = sync.store.upsertEvents("source-1", seededEvents());
    expect(expected).toEqual({ inserted: 40, updated: 0 });

    for (const chunkEvents of [1, 7, 1000]) {
      // 每个粒度都用一份干净的存储，计数才可比。
      const chunked = await CalendarStore.open(fileIO, storePath);
      chunked.store.upsertSource(makeSource());
      const run = drain(
        chunked.store.upsertEventsInChunks(
          "source-1",
          seededEvents(),
          chunkEvents,
        ),
      );
      expect(run.result).toEqual(expected);
      expect(chunked.store.listEvents()).toEqual(sync.store.listEvents());
    }
  });

  it("重复 upsert 走更新分支：增强结果失效，计数与同步入口一致", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource());
    store.upsertEvents("source-1", seededEvents());
    const identity = {
      sourceId: "source-1",
      uid: "event-0@semantic-calendar",
    };
    store.saveEnrichment(identity, { semantic: fixtureSemantic });

    const run = drain(
      store.upsertEventsInChunks(
        "source-1",
        [makeEvent({ uid: "event-0@semantic-calendar" })],
        1,
      ),
    );

    expect(run.result).toEqual({ inserted: 0, updated: 1 });
    expect(store.getEnrichment(identity)).toBeUndefined();
  });

  it("replaceSourceEventsInChunks 与同步入口相同：消失的删、仍在的保留", async () => {
    const sync = await CalendarStore.open(fileIO, storePath);
    const chunked = await CalendarStore.open(fileIO, storePath);
    for (const { store } of [sync, chunked]) {
      store.upsertSource(makeSource());
      store.upsertEvents("source-1", seededEvents());
    }

    // 批次里只剩前 20 条：后 20 条应当被删掉。
    const batch = seededEvents().slice(0, 20);

    const expected = sync.store.replaceSourceEvents("source-1", batch);
    const run = drain(
      chunked.store.replaceSourceEventsInChunks("source-1", batch, 3),
    );

    expect(run.result).toEqual(expected);
    expect(run.result.removed).toBe(20);
    expect(chunked.store.listEvents()).toEqual(sync.store.listEvents());
  });

  it("listEnrichedEventsInChunks 与同步入口逐条相同（含增强连接与排序）", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource());
    store.upsertEvents("source-1", seededEvents());
    store.saveEnrichment(
      { sourceId: "source-1", uid: "event-3@semantic-calendar" },
      { semantic: fixtureSemantic, metadata: { display: "badge" } },
    );

    const expected = store.listEnrichedEvents();
    for (const chunkEvents of [1, 6, 1000]) {
      expect(
        drain(store.listEnrichedEventsInChunks(undefined, chunkEvents)).result,
      ).toEqual(expected);
    }

    // 读取结果与存储内部状态解耦：改结果不会污染存储（逐条克隆仍在）。
    const loaded = drain(store.listEnrichedEventsInChunks(undefined, 4)).result;
    loaded[0].title = "被改过的结果";
    expect(store.listEvents().map((event) => event.title)).not.toContain(
      "被改过的结果",
    );
  });

  it("分片落库期间读到的版本号一定与结束后的不同（否则读取方会跳过重读）", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource());

    const steps = store.upsertEventsInChunks("source-1", seededEvents(), 4);
    // 第一个任务之后：一部分事件已入库（分片进行到一半）。
    expect(steps.next().done).toBe(false);
    const midwayRevision = store.eventsRevision();
    const midwayCount = store.listEvents().length;

    drain(steps);

    expect(midwayCount).toBeGreaterThan(0);
    expect(midwayCount).toBeLessThan(store.listEvents().length);
    expect(store.eventsRevision()).not.toBe(midwayRevision);
  });

  it("小批量一次跑完：版本号只推进一次（与改动前完全一致）", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource());

    // 少于一个分片粒度：同步入口一次排空，没有让出点。
    store.upsertEvents("source-1", seededEvents().slice(0, 5));

    expect(store.eventsRevision()).toBe(1);
  });

  it("保存的快照文本与旧路径（toSnapshot + stringify）逐字节相同", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);
    store.upsertSource(makeSource());
    store.upsertSource(
      makeSource({ id: "source-2", name: "订阅", type: "webcal" }),
    );
    store.upsertEvents("source-1", seededEvents());
    store.upsertEvents("source-2", seededEvents().slice(0, 5));
    store.saveEnrichment(
      { sourceId: "source-1", uid: "event-1@semantic-calendar" },
      { semantic: fixtureSemantic, metadata: { display: "badge", rank: 2 } },
    );
    store.setSetting("theme", "dark");
    store.setSetting("followedTeams", ["arsenal", "liverpool"]);
    // 快照里值为 undefined 的键不输出（与 JSON.stringify 同一口径）。
    store.setSetting("空值", undefined);

    const written = await store.serializeSnapshot();

    expect(written).toBe(JSON.stringify(store.toSnapshot(), null, 2));
    // 真实落盘：文件内容与直接序列化一致，且能原样读回。
    await store.save();
    expect(await readFile(storePath, "utf8")).toBe(written);
    const { store: reopened } = await CalendarStore.open(fileIO, storePath);
    expect(reopened.listEvents()).toHaveLength(45);
    expect(reopened.getSetting("followedTeams")).toEqual([
      "arsenal",
      "liverpool",
    ]);
  });

  it("空存储的快照也是逐字节相同的：空分区不展开", async () => {
    const { store } = await CalendarStore.open(fileIO, storePath);

    const written = await store.serializeSnapshot();

    expect(written).toBe(JSON.stringify(store.toSnapshot(), null, 2));
    expect(written).toContain('"sources": []');
    expect(written).toContain('"settings": {}');
  });
});
