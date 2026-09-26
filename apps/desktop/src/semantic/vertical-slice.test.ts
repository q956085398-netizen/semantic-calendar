// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bucketEventsByDateKey } from "../calendar/event-buckets";
import { importLocalIcs } from "../data/import/import-local-ics";
import type {
  HttpGetRequest,
  HttpGetResponse,
  HttpIO,
} from "../data/net/http-io";
import { CalendarStore } from "../data/store/calendar-store";
import { NodeFileIO } from "../data/store/node-file-io";
import {
  addWebcalSubscription,
  refreshWebcalSource,
} from "../data/webcal/webcal-refresh";
import type { EnrichedEvent } from "../data/model";
import { expandEventOccurrences } from "../normalize/occurrences";
import { planReminders } from "../notifications/reminder-plan";
import { createAppSemanticStack } from "./app-registry";
import { reEnrichStore } from "./enrich";
import { displayMetadataOf } from "./metadata-resolver";

/**
 * 垂直链路集成（SC-021 / app-spec §17）。
 *
 * 这里跑的是**应用真正装配出来的那一套**语义栈（`createAppSemanticStack`），
 * 而不是测试自建的替身 Matcher：注册表掉了一个 Matcher、Matcher 与 Resolver
 * 的接口对不上、扩展分区写不进快照，这些都会在这里失败。
 *
 * 覆盖 app-spec §17 要求的两条集成链：
 *   ICS → Normalize → Match → Persist → Calendar View
 *   WebCal refresh → dedupe → update（+ 重新匹配）
 *
 * 与 `normalize/pipeline.test.ts` 的分工：那条链在 Matcher 之前就结束
 * （SC-008 的范围），这条从导入一直走到月格消费的数据形态。
 *
 * 时区断注：所有时刻取 12:00Z / 13:00Z（伦敦午间），在 ±11 小时内任何观察
 * 时区都落在同一公历日，覆盖全部目标运行环境（中 / 英 / 美）。
 */

const STORE_FILE = "calendar-store.json";
const FEED_URL = "https://calendar.example.com/epl.ics";

let dataDir: string;
let storePath: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "semantic-calendar-slice-"));
  storePath = path.join(dataDir, STORE_FILE);
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

async function openStore(): Promise<CalendarStore> {
  return (await CalendarStore.open(new NodeFileIO(), storePath)).store;
}

interface StubHttp extends HttpIO {
  requests: HttpGetRequest[];
}

/** 按顺序返回预置响应；用尽后重复最后一个。 */
function stubHttp(...responses: Array<HttpGetResponse | Error>): StubHttp {
  const requests: HttpGetRequest[] = [];
  let index = 0;
  return {
    requests,
    async get(request: HttpGetRequest): Promise<HttpGetResponse> {
      requests.push(request);
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
  };
}

function ics(eventLines: string[][]): string {
  const events = eventLines
    .map((lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n"))
    .join("\r\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Semantic Calendar//Vertical Slice//CN",
    events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function okResponse(body: string): HttpGetResponse {
  return { status: 200, notModified: false, body };
}

/** 月格消费的数据形态：按日期键分桶的 enriched 事件（UI 拿到的就是它）。 */
function bucketsOf(
  store: CalendarStore,
  from: string,
  to: string,
): Map<string, EnrichedEvent[]> {
  return bucketEventsByDateKey(
    expandEventOccurrences(store.listEnrichedEvents(), { from, to }),
  );
}

function eventOn(
  buckets: Map<string, EnrichedEvent[]>,
  dateKey: string,
  uid: string,
): EnrichedEvent | undefined {
  return buckets.get(dateKey)?.find((event) => event.uid === uid);
}

/**
 * 展示载荷按 UI 的读取边界取值（`displayMetadataOf` 会收窄磁盘 JSON）。
 * 直接读 `event.metadata` 只证明分区里有东西，这里证明界面真的拿得到。
 */
function displayOf(event: EnrichedEvent | undefined) {
  return event === undefined ? undefined : displayMetadataOf(event);
}

/**
 * 提醒计划（app-spec §17 第二条链的最后一站）：输入口径与 App 一致——
 * 展开后的 occurrence + 通知总开关 + 跟随 Resolver 建议的提前量。
 */
function remindersOf(store: CalendarStore, nowIso: string) {
  return planReminders({
    events: expandEventOccurrences(store.listEnrichedEvents(), {
      from: "2026-10-01",
      to: "2026-10-31",
    }),
    notificationsEnabled: true,
    matchReminder: undefined,
    nowMs: Date.parse(nowIso),
  });
}

/** 导入一段 ICS 并跑一次应用级匹配（与 App 启动 / 导入后的步骤一致）。 */
async function importAndMatch(
  store: CalendarStore,
  fileName: string,
  contents: string,
) {
  const outcome = await importLocalIcs(store, { fileName, contents });
  const stats = reEnrichStore(store, createAppSemanticStack());
  return { outcome, stats };
}

describe("垂直链路：ICS → Normalize → Match → Persist → 月格（app-spec §17）", () => {
  const IMPORT_ICS = ics([
    [
      "UID:match@example.com",
      // 全角 + 多余空格：Normalizer 的标题规范化必须是这条链的一部分。
      "SUMMARY:　Ａｒｓｅｎａｌ　ｖｓ　Ｍａｎｃｈｅｓｔｅｒ　Ｃｉｔｙ　",
      "LOCATION:Emirates Stadium",
      "DTSTART:20261018T120000Z",
      "DTEND:20261018T140000Z",
    ],
    ["UID:standup@example.com", "SUMMARY:每周站会", "DTSTART:20261018T130000Z"],
  ]);

  it("导入的 ICS 经真实 Matcher 落库：比赛带展示载荷，普通事件不增强", async () => {
    const store = await openStore();
    const { outcome, stats } = await importAndMatch(
      store,
      "mixed.ics",
      IMPORT_ICS,
    );
    expect(outcome.skipped).toBe(0);
    expect(stats).toEqual({ matched: 1, unmatched: 1 });

    const buckets = bucketsOf(store, "2026-10-01", "2026-10-31");
    const match = eventOn(buckets, "2026-10-18", "match@example.com");
    expect(match?.normalizedTitle).toBe("Arsenal vs Manchester City");
    expect(match?.semantic).toMatchObject({
      type: "sport.fixture",
      subtype: "premier-league",
      entities: [
        { type: "team", id: "arsenal" },
        { type: "team", id: "manchester-city" },
      ],
    });
    // 展示载荷（联赛短标签 + 双方队标）：月格「队标 VS 队标」消费的就是它。
    expect(displayOf(match)?.label).toBe("英超");
    expect(displayOf(match)?.fixture?.teams.map((team) => team.code)).toEqual([
      "ARS",
      "MCI",
    ]);

    // 非比赛标题：未命中不写增强记录，事件照常出现在月格（SEM-003）。
    const standup = eventOn(buckets, "2026-10-18", "standup@example.com");
    expect(standup).toBeDefined();
    expect(standup?.semantic).toBeUndefined();
    expect(standup?.metadata).toBeUndefined();
  });

  it("重启后语义仍在：增强分区随快照落盘，不需要重新导入或重新匹配", async () => {
    const store = await openStore();
    await importAndMatch(store, "mixed.ics", IMPORT_ICS);
    await store.save();

    const reopened = await openStore();
    const buckets = bucketsOf(reopened, "2026-10-01", "2026-10-31");
    const match = eventOn(buckets, "2026-10-18", "match@example.com");
    expect(match?.semantic?.type).toBe("sport.fixture");
    expect(displayOf(match)?.label).toBe("英超");
    // 原始事实没有被匹配过程改写（P-04 语义与展示分离）。
    expect(match?.title).toContain("Ａｒｓｅｎａｌ");
  });
});

describe("垂直链路：WebCal refresh → dedupe → update → 重新匹配（app-spec §17）", () => {
  const FIRST_FEED = ics([
    [
      "UID:match-1@example.com",
      "SUMMARY:Arsenal vs Manchester City",
      "DTSTART:20261018T120000Z",
      "DTEND:20261018T140000Z",
    ],
    [
      "UID:standup-1@example.com",
      "SUMMARY:每周站会",
      "DTSTART:20261018T130000Z",
    ],
  ]);

  /** 第二次抓取：比赛改了期且标题不再是对阵，站会消失，新增一场比赛。 */
  const SECOND_FEED = ics([
    [
      "UID:match-1@example.com",
      "SUMMARY:Emirates Stadium tour",
      "DTSTART:20261019T120000Z",
      "DTEND:20261019T140000Z",
    ],
    [
      "UID:match-2@example.com",
      "SUMMARY:Liverpool vs Chelsea",
      "DTSTART:20261018T130000Z",
      "DTEND:20261018T150000Z",
    ],
  ]);

  it("刷新按 UID 去重更新：消失的删除、改动的就地更新、新增的入库", async () => {
    const store = await openStore();
    const http = stubHttp(okResponse(FIRST_FEED), okResponse(SECOND_FEED));

    const added = await addWebcalSubscription(store, { url: FEED_URL }, http, {
      now: () => new Date("2026-10-01T08:00:00.000Z"),
    });
    const sourceId = added.sourceId!;
    reEnrichStore(store, createAppSemanticStack());
    expect(
      eventOn(
        bucketsOf(store, "2026-10-01", "2026-10-31"),
        "2026-10-18",
        "match-1@example.com",
      )?.semantic?.type,
    ).toBe("sport.fixture");

    // 刷新前：比赛按 Resolver 的建议提醒（赛前 30 分钟），这是计划重排的对照点。
    const beforeRefresh = remindersOf(store, "2026-10-01T00:00:00.000Z");
    expect(beforeRefresh).toHaveLength(1);
    expect(beforeRefresh[0]).toMatchObject({
      source: "resolver-policy",
      fireAtMs: Date.parse("2026-10-18T11:30:00.000Z"),
    });
    expect(beforeRefresh[0].eventId).toContain("match-1@example.com");

    const refreshed = await refreshWebcalSource(store, sourceId, http, {
      now: () => new Date("2026-10-02T08:00:00.000Z"),
    });
    expect(refreshed).toMatchObject({
      status: "updated",
      inserted: 1,
      updated: 1,
      removed: 1,
    });

    // 去重：同 UID 的改动不会留下第二份记录，消失的事件整条不再存在。
    expect(
      store
        .listEvents(sourceId)
        .map((event) => event.uid)
        .sort(),
    ).toEqual(["match-1@example.com", "match-2@example.com"]);
    expect(
      store.getEnrichment({ sourceId, uid: "standup-1@example.com" }),
    ).toBeUndefined();

    // 语义随刷新重建（App 的刷新路径同样在落盘前跑一次重建）：
    reEnrichStore(store, createAppSemanticStack());

    const buckets = bucketsOf(store, "2026-10-01", "2026-10-31");
    // 改期落到了新的一天，旧的一天不再有这条事件。
    expect(
      eventOn(buckets, "2026-10-18", "match-1@example.com"),
    ).toBeUndefined();
    // 标题不再是对阵：旧识别结果不会残留成幽灵语义。
    const moved = eventOn(buckets, "2026-10-19", "match-1@example.com");
    expect(moved?.title).toBe("Emirates Stadium tour");
    expect(moved?.semantic).toBeUndefined();
    // 新增的比赛被识别，展示载荷照常。
    const added2 = eventOn(buckets, "2026-10-18", "match-2@example.com");
    expect(added2?.semantic?.entities?.map((entity) => entity.id)).toEqual([
      "liverpool",
      "chelsea",
    ]);
    expect(displayOf(added2)?.label).toBe("英超");

    // 提醒计划随刷新重排（app-spec §17 第二条链的最后一站）：改期那场不再
    // 按比赛提醒（标题已不是对阵），新增那场按新时间提醒，消失的那场没有残留。
    const afterRefresh = remindersOf(store, "2026-10-01T00:00:00.000Z");
    expect(afterRefresh).toHaveLength(1);
    expect(afterRefresh[0]).toMatchObject({
      source: "resolver-policy",
      fireAtMs: Date.parse("2026-10-18T12:30:00.000Z"),
      title: "Liverpool vs Chelsea",
    });
    expect(afterRefresh[0].eventId).toContain("match-2@example.com");
  });

  it("304 之后语义不变：缓存事件与识别结果都还在（SRC-004）", async () => {
    const store = await openStore();
    const http = stubHttp(okResponse(FIRST_FEED), {
      status: 304,
      notModified: true,
    });

    const added = await addWebcalSubscription(store, { url: FEED_URL }, http, {
      now: () => new Date("2026-10-01T08:00:00.000Z"),
    });
    reEnrichStore(store, createAppSemanticStack());

    const refreshed = await refreshWebcalSource(store, added.sourceId!, http, {
      now: () => new Date("2026-10-02T08:00:00.000Z"),
    });
    expect(refreshed.status).toBe("not-modified");
    reEnrichStore(store, createAppSemanticStack());

    const match = eventOn(
      bucketsOf(store, "2026-10-01", "2026-10-31"),
      "2026-10-18",
      "match-1@example.com",
    );
    expect(match?.semantic?.type).toBe("sport.fixture");
  });
});
