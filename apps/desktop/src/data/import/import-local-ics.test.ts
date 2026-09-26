// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CalendarStore } from "../store/calendar-store";
import { NodeFileIO } from "../store/node-file-io";
import { importLocalIcs, sourceIdForLocalIcsFile } from "./import-local-ics";

let dataDir: string;
let store: CalendarStore;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "semantic-calendar-import-"));
  const opened = await CalendarStore.open(
    new NodeFileIO(),
    path.join(dataDir, "calendar-store.json"),
  );
  store = opened.store;
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const TWO_EVENTS_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:match-1@example.com",
  "SUMMARY:Arsenal vs Manchester City",
  "DTSTART:20261018T163000Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:match-2@example.com",
  "SUMMARY:Liverpool vs Chelsea",
  "DTSTART:20261025T150000Z",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

describe("sourceIdForLocalIcsFile", () => {
  it("同一文件名得到稳定 id，扩展名与空白归一化", () => {
    expect(sourceIdForLocalIcsFile("basic.ics")).toBe("local-ics:basic");
    expect(sourceIdForLocalIcsFile("My Calendar (2026).ics")).toBe(
      "local-ics:my-calendar-2026",
    );
    expect(sourceIdForLocalIcsFile("basic.ics")).toBe("local-ics:basic");
  });

  it("保留 Unicode 文件名（中文常见），拒绝路径分隔符参与", () => {
    expect(sourceIdForLocalIcsFile("中国节假日 2026.ics")).toBe(
      "local-ics:中国节假日-2026",
    );
    // 路径分隔符被归一化，不会产生层级语义。
    expect(sourceIdForLocalIcsFile("..\\evil/name.ics")).toBe(
      "local-ics:evil-name",
    );
  });
});

describe("importLocalIcs — 首次导入", () => {
  it("创建 local-ics 数据源并写入状态（SRC-003）", async () => {
    const outcome = await importLocalIcs(store, {
      fileName: "premier-league.ics",
      contents: TWO_EVENTS_ICS,
    });

    expect(outcome.source).toBeDefined();
    expect(outcome.source).toMatchObject({
      id: "local-ics:premier-league",
      type: "local-ics",
      name: "premier-league.ics",
      enabled: true,
      lastSyncStatus: "ok",
    });
    expect(outcome.source?.lastSyncAt).toEqual(expect.any(String));
  });

  it("事件落库并回填稳定 sourceId，基础字段完整保留", async () => {
    const outcome = await importLocalIcs(store, {
      fileName: "premier-league.ics",
      contents: TWO_EVENTS_ICS,
    });

    expect(outcome.inserted).toBe(2);
    const events = store.listEvents("local-ics:premier-league");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      uid: "match-1@example.com",
      title: "Arsenal vs Manchester City",
      allDay: false,
      start: "2026-10-18T16:30:00.000Z",
    });
  });

  it("入库事件带标准化字段（SC-008：normalizedTitle / timezone）", async () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:fullwidth@example.com",
      "SUMMARY:　Ａｒｓｅｎａｌ　ｖｓ　Ｃｉｔｙ　",
      "DTSTART;TZID=Europe/London:20261018T150000",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:utc@example.com",
      "SUMMARY:UTC kickoff",
      "DTSTART:20261025T150000Z",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");

    await importLocalIcs(store, { fileName: "norm.ics", contents: ics });

    const events = store.listEvents("local-ics:norm");
    expect(events[0]).toMatchObject({
      title: "　Ａｒｓｅｎａｌ　ｖｓ　Ｃｉｔｙ　",
      normalizedTitle: "Arsenal vs City",
      timezone: "Europe/London",
      startTzid: "Europe/London",
    });
    expect(events[1]).toMatchObject({
      normalizedTitle: "UTC kickoff",
      timezone: "UTC",
    });
  });
});

describe("importLocalIcs — 重复导入去重（ICS-001）", () => {
  it("再次导入同一文件不产生重复副本", async () => {
    await importLocalIcs(store, {
      fileName: "premier-league.ics",
      contents: TWO_EVENTS_ICS,
    });
    const outcome = await importLocalIcs(store, {
      fileName: "premier-league.ics",
      contents: TWO_EVENTS_ICS,
    });

    expect(outcome.inserted).toBe(0);
    expect(outcome.updated).toBe(2);
    expect(store.listEvents("local-ics:premier-league")).toHaveLength(2);
    expect(store.listSources()).toHaveLength(1);
  });

  it("内容变化的事件被更新而不是新增", async () => {
    await importLocalIcs(store, {
      fileName: "premier-league.ics",
      contents: TWO_EVENTS_ICS,
    });
    const updatedIcs = TWO_EVENTS_ICS.replace(
      "Arsenal vs Manchester City",
      "Arsenal vs Chelsea (rescheduled)",
    );
    const outcome = await importLocalIcs(store, {
      fileName: "premier-league.ics",
      contents: updatedIcs,
    });

    expect(outcome.updated).toBe(2);
    const titles = store
      .listEvents("local-ics:premier-league")
      .map((event) => event.title);
    expect(titles).toContain("Arsenal vs Chelsea (rescheduled)");
    expect(titles).not.toContain("Arsenal vs Manchester City");
  });

  it("内容更新后旧增强结果失效，等待重新匹配（SEM-004）", async () => {
    await importLocalIcs(store, {
      fileName: "premier-league.ics",
      contents: TWO_EVENTS_ICS,
    });
    const event = store.listEvents("local-ics:premier-league")[0];
    store.saveEnrichment(
      { sourceId: event.sourceId, uid: event.uid },
      { semantic: { type: "sport.fixture" } },
    );

    await importLocalIcs(store, {
      fileName: "premier-league.ics",
      contents: TWO_EVENTS_ICS,
    });

    expect(
      store.getEnrichment({ sourceId: event.sourceId, uid: event.uid }),
    ).toBeUndefined();
  });
});

describe("importLocalIcs — 错误隔离与失败（ICS-005）", () => {
  it("坏事件被跳过并计数，好事件继续导入", async () => {
    const mixed = TWO_EVENTS_ICS.replace(
      "UID:match-1@example.com",
      "SUMMARY:no-uid-here",
    );
    const outcome = await importLocalIcs(store, {
      fileName: "mixed.ics",
      contents: mixed,
    });

    expect(outcome.inserted).toBe(1);
    expect(outcome.skipped).toBe(1);
    expect(outcome.issues).toHaveLength(1);
    expect(outcome.issues[0].eventIndex).toBe(1);
  });

  it("文件级失败不创建数据源", async () => {
    const outcome = await importLocalIcs(store, {
      fileName: "broken.ics",
      contents: "这不是日历文件",
    });

    expect(outcome.source).toBeUndefined();
    expect(outcome.inserted).toBe(0);
    expect(store.listSources()).toEqual([]);
    expect(store.listEvents()).toEqual([]);
    expect(outcome.issues[0].eventIndex).toBeUndefined();
  });

  it("合法但空的日历创建空源，不算失败", async () => {
    const outcome = await importLocalIcs(store, {
      fileName: "empty.ics",
      contents: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n",
    });

    expect(outcome.source).toBeDefined();
    expect(outcome.inserted).toBe(0);
    expect(outcome.issues).toEqual([]);
  });
});

describe("importLocalIcs — 持久化往返", () => {
  it("保存后重新打开 store，数据源与事件仍在", async () => {
    const storePath = path.join(dataDir, "calendar-store.json");
    await importLocalIcs(store, {
      fileName: "premier-league.ics",
      contents: TWO_EVENTS_ICS,
    });
    await store.save();

    const reopened = await CalendarStore.open(new NodeFileIO(), storePath);
    expect(reopened.store.listSources()).toHaveLength(1);
    expect(reopened.store.listEvents("local-ics:premier-league")).toHaveLength(
      2,
    );
  });
});
