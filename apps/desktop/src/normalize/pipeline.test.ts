// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bucketEventsByDateKey } from "../calendar/event-buckets";
import { importLocalIcs } from "../data/import/import-local-ics";
import { CalendarStore } from "../data/store/calendar-store";
import { NodeFileIO } from "../data/store/node-file-io";
import { expandEventOccurrences } from "./occurrences";

/**
 * SC-008 集成链路（app-spec §17）：
 * ICS 文本 → 解析 → 标准化入库 → 快照往返 → occurrence 展开 → 月格分桶。
 * Matcher（SC-009）之前的整条数据链路必须真实可用。
 *
 * 时区断注：比赛事件取伦敦 13:00（= 12:00Z 午间瞬时），在 ±11 小时内
 * 任何观察时区都落在同一公历日，覆盖全部目标运行环境（中 / 英 / 美）。
 */

const MIXED_CALENDAR_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Semantic Calendar//Integration//CN",
  "BEGIN:VTIMEZONE", // 真实文件常带 VTIMEZONE；解析器应跳过并不影响事件
  "TZID:Europe/London",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700329T010000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "TZNAME:BST",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:pl-match@example.com",
  "SUMMARY:　Ａｒｓｅｎａｌ　ｖｓ　Ｍａｎｃｈｅｓｔｅｒ　Ｃｉｔｙ　",
  "DTSTART;TZID=Europe/London:20261018T130000",
  "DTEND;TZID=Europe/London:20261018T150000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:national-day@example.com",
  "SUMMARY:国庆假期",
  "DTSTART;VALUE=DATE:20261001",
  "DTEND;VALUE=DATE:20261008",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:weekly-standup@example.com",
  "SUMMARY:每周站会",
  "DTSTART:20260930T090000",
  "RRULE:FREQ=WEEKLY;COUNT=10",
  "EXDATE:20261014T090000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:weekly-standup@example.com",
  "RECURRENCE-ID:20261021T090000",
  "SUMMARY:每周站会",
  "DTSTART:20261021T090000",
  "STATUS:CANCELLED",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:weekly-standup@example.com",
  "RECURRENCE-ID:20261028T090000",
  "SUMMARY:每周站会（提前）",
  "DTSTART:20261022T150000",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

let dataDir: string;
let storePath: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "semantic-calendar-pipeline-"));
  storePath = path.join(dataDir, "calendar-store.json");
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

async function openStore() {
  return (await CalendarStore.open(new NodeFileIO(), storePath)).store;
}

describe("ICS → 标准化 → 落库 → 展开 → 月格（SC-008 集成）", () => {
  it("导入后月视图分桶呈现正确：时区、全天跨度、重复、EXDATE、例外", async () => {
    const store = await openStore();
    const outcome = await importLocalIcs(store, {
      fileName: "mixed.ics",
      contents: MIXED_CALENDAR_ICS,
    });
    await store.save();

    expect(outcome.skipped).toBe(0);
    // 比赛 + 假期 + 每周主事件 + 取消例外 + 改期例外。
    expect(outcome.inserted).toBe(5);

    const occurrences = expandEventOccurrences(store.listEnrichedEvents(), {
      from: "2026-10-01",
      to: "2026-10-31",
    });
    const buckets = bucketEventsByDateKey(occurrences);

    // 1) TZID 比赛事件：全角标题已标准化，墙钟 13:00 BST 换算为 12:00Z。
    const match = buckets
      .get("2026-10-18")
      ?.find((event) => event.uid === "pl-match@example.com");
    expect(match).toMatchObject({
      normalizedTitle: "Arsenal vs Manchester City",
      start: "2026-10-18T12:00:00.000Z",
      end: "2026-10-18T14:00:00.000Z",
      timezone: "Europe/London",
    });

    // 2) 全天假期铺满 10-01 … 10-07（DTEND 独占语义，ICS-002 不漂移）。
    for (const day of ["2026-10-01", "2026-10-04", "2026-10-07"]) {
      expect(
        buckets
          .get(day)
          ?.some((event) => event.uid === "national-day@example.com"),
      ).toBe(true);
    }
    expect(
      buckets
        .get("2026-10-08")
        ?.some((event) => event.uid === "national-day@example.com") ?? false,
    ).toBe(false);

    // 3) 每周站会：10-07 正常；10-14 被 EXDATE；10-21 被取消；
    //    10-28 原实例被改期例外替换到 10-22 15:00，两者均不重复。
    const standupDays = [
      "2026-10-07",
      "2026-10-14",
      "2026-10-21",
      "2026-10-28",
    ].filter((day) =>
      buckets
        .get(day)
        ?.some((event) => event.uid === "weekly-standup@example.com"),
    );
    expect(standupDays).toEqual(["2026-10-07"]);

    const moved = buckets
      .get("2026-10-22")
      ?.find((event) => event.title === "每周站会（提前）");
    expect(moved).toMatchObject({
      start: "2026-10-22T15:00:00",
      occurrenceId: "2026-10-28T09:00:00",
    });

    // 全网格内该系列恰好两个实例（10-07 与改期后的 10-22）。
    const seriesCount = occurrences.filter(
      (event) => event.uid === "weekly-standup@example.com",
    );
    expect(seriesCount).toHaveLength(2);
  });

  it("快照往返后展开结果一致（持久化不丢失原始事实）", async () => {
    const store = await openStore();
    await importLocalIcs(store, {
      fileName: "mixed.ics",
      contents: MIXED_CALENDAR_ICS,
    });
    await store.save();

    const reopened = await openStore();
    const occurrences = expandEventOccurrences(reopened.listEnrichedEvents(), {
      from: "2026-10-01",
      to: "2026-10-31",
    });

    // occurrence 数：比赛 1 + 假期 1（单实例铺 7 天）+ 站会系列 2。
    expect(occurrences).toHaveLength(4);
    const stored = reopened.listEvents("local-ics:mixed");
    expect(stored).toHaveLength(5);
    expect(
      stored.filter((event) => event.normalizedTitle !== undefined),
    ).toHaveLength(5);
  });
});
