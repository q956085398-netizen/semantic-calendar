// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isChunkBoundary } from "../../scheduling/chunk-boundary";
import { createTimeSlicedRun } from "../../scheduling/time-sliced";
import { yieldToMain } from "../../scheduling/yield-to-main";
import {
  ICS_CHUNK_EVENTS,
  parseIcsCalendarInChunks,
} from "../../ics/parse-ics";
import {
  NORMALIZE_CHUNK_EVENTS,
  normalizeEventsInChunks,
} from "../../normalize/normalizer";
import { createAppSemanticStack } from "../../semantic/app-registry";
import { reEnrichStoreYielding } from "../../semantic/enrich";
import { CalendarStore, STORE_CHUNK_EVENTS } from "../store/calendar-store";
import { enrichedEventsInChunks } from "../store/enriched-events-load";
import { NodeFileIO } from "../store/node-file-io";
import { importLocalIcs, importLocalIcsYielding } from "./import-local-ics";

/**
 * SC-024：导入链路的分片。
 *
 * 三条被测的东西：
 * 1. **分片不改变结果**：分片入口与同步入口在同一个输入上产出同一份事件集合
 *    （逐条比较），包括跨过生产分片粒度的输入；
 * 2. **让出点是结构而不是巧合**：生产粒度下每段都有可数的让出点，去掉任何一处
 *    都会在这里失败（这是「不再出现长任务」的机制保证，确定性、不看时钟）；
 * 3. **整条动作全程分片**：导入 → 增强 → 落盘 → 读取走一遍，任务数远多于同步实现
 *    （同步只有 5 个），且结果完整。墙钟与「最长任务」不在这里断言——那是基准的
 *    对象（performance.md §3.5；抖动说明见 §3.3），用例只钉结构。
 */

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "semantic-calendar-slices-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** 一条事件一份 VEVENT，条数由下标推出：不依赖随机数与时区。 */
function buildIcs(eventCount: number): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0"];
  for (let index = 0; index < eventCount; index += 1) {
    const day = String((index % 28) + 1).padStart(2, "0");
    const hour = String(index % 24).padStart(2, "0");
    const minute = String((index * 7) % 60).padStart(2, "0");
    lines.push(
      "BEGIN:VEVENT",
      `UID:event-${index}@semantic-calendar.test`,
      `SUMMARY:导入链路事件 ${index}`,
      `DTSTART:202610${day}T${hour}${minute}00Z`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR", "");
  return lines.join("\r\n");
}

async function openStore(name: string): Promise<CalendarStore> {
  const { store } = await CalendarStore.open(
    new NodeFileIO(),
    path.join(dataDir, name),
  );
  return store;
}

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

describe("分片导入：结果与同步入口相同（SC-024）", () => {
  it("分片入口与同步入口产出同一份事件集合与同一份结果", async () => {
    // 300 条超过生产分片粒度（128），因此两条路径都真的跨片执行过。
    const contents = buildIcs(300);
    const syncStore = await openStore("sync.json");
    const slicedStore = await openStore("sliced.json");

    const sync = await importLocalIcs(syncStore, {
      fileName: "chain.ics",
      contents,
    });
    const sliced = await importLocalIcsYielding(slicedStore, {
      fileName: "chain.ics",
      contents,
    });

    expect(sliced.inserted).toBe(sync.inserted);
    expect(sliced.updated).toBe(sync.updated);
    expect(sliced.skipped).toBe(sync.skipped);
    expect(sliced.issues).toEqual(sync.issues);
    // 来源形态一致；lastSyncAt 是「此刻」的时间戳，两次导入必然不同，单独看。
    expect(sliced.source).toMatchObject({
      id: "local-ics:chain",
      type: "local-ics",
      name: "chain.ics",
      enabled: true,
      lastSyncStatus: "ok",
    });
    expect(sliced.source?.lastSyncAt).toBeDefined();
    expect(slicedStore.listEvents()).toEqual(syncStore.listEvents());
    // 去重语义不变（ICS-001）：再导入一次是更新而不是新增。
    const again = await importLocalIcsYielding(slicedStore, {
      fileName: "chain.ics",
      contents,
    });
    expect(again).toMatchObject({ inserted: 0, updated: 300 });
  });

  it("小分片粒度下同样是同一份结果（逐片边界都被走到）", async () => {
    const contents = buildIcs(60);
    const syncStore = await openStore("sync-small.json");
    const slicedStore = await openStore("sliced-small.json");

    const sync = await importLocalIcs(syncStore, {
      fileName: "chain.ics",
      contents,
    });
    const sliced = await importLocalIcsYielding(
      slicedStore,
      { fileName: "chain.ics", contents },
      { eventsPerChunk: 1 },
    );

    expect(sliced).toMatchObject({
      inserted: sync.inserted,
      updated: sync.updated,
      skipped: sync.skipped,
    });
    expect(slicedStore.listEvents()).toEqual(syncStore.listEvents());
  });

  it("坏事件隔离与文件级失败（ICS-005）在分片路径上不变", async () => {
    const broken = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:good@semantic-calendar.test",
      "SUMMARY:好事件",
      "DTSTART:20261018T090000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:broken@semantic-calendar.test",
      "SUMMARY:缺 DTSTART",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    const store = await openStore("broken.json");

    const outcome = await importLocalIcsYielding(
      store,
      { fileName: "broken.ics", contents: broken },
      { eventsPerChunk: 1 },
    );

    expect(outcome.inserted).toBe(1);
    expect(outcome.skipped).toBe(1);
    expect(store.listEvents()).toHaveLength(1);
  });
});

describe("分片让出点是结构（SC-024）", () => {
  it("生产粒度下解析、标准化、落库各有可数的让出点", async () => {
    const eventCount = 1_000;
    const contents = buildIcs(eventCount);
    const store = await openStore("structure.json");

    const parsed = drain(parseIcsCalendarInChunks(contents));
    expect(parsed.result.events).toHaveLength(eventCount);
    // 逐块解析（1,000 / 128）与两趟逐行扫描（约 6,000 行 / 1024）各自都有让出点；
    // 只数总数不足以区分两段，因此要求明显多于「只有逐块解析」时的数量。
    const blockYields = Math.floor(eventCount / ICS_CHUNK_EVENTS) - 1;
    expect(parsed.yields).toBeGreaterThan(blockYields + 3);

    const stored = drain(
      normalizeEventsInChunks(parsed.result.events, "local-ics:chain"),
    );
    expect(stored.yields).toBeGreaterThanOrEqual(
      Math.floor(eventCount / NORMALIZE_CHUNK_EVENTS) - 1,
    );

    const upserted = drain(
      store.upsertEventsInChunks("local-ics:chain", stored.result),
    );
    expect(upserted.yields).toBeGreaterThanOrEqual(
      Math.floor(eventCount / STORE_CHUNK_EVENTS) - 1,
    );
  });

  it("逐行扫描确实分片：行多块少时也有让出点（去掉行扫描的让出点会失败）", () => {
    // 一个 VEVENT，前面堆一批无关注释行：块只有 1 个，行有 3,000 多行。
    const filler = Array.from(
      { length: 3_000 },
      (_unused, index) => `X-NOTE-${index}:填充行`,
    );
    const contents = [
      "BEGIN:VCALENDAR",
      ...filler,
      "BEGIN:VEVENT",
      "UID:only@semantic-calendar.test",
      "SUMMARY:一行事件",
      "DTSTART:20261018T090000Z",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");

    const parsed = drain(parseIcsCalendarInChunks(contents));

    expect(parsed.result.events).toHaveLength(1);
    // 3,000+ 行 / 1024 ≈ 3 个让出点，全部来自逐行扫描（块只有一个）。
    expect(parsed.yields).toBeGreaterThanOrEqual(3);
    // 不切片时一个让出点都没有（同一份输入，两条入口结果相同）。
    expect(drain(parseIcsCalendarInChunks(contents, 0, 0)).yields).toBe(0);
  });

  it("边界条件只有一个实现：第 chunk 个元素之后让出", () => {
    expect(isChunkBoundary(0, 128)).toBe(false);
    expect(isChunkBoundary(127, 128)).toBe(false);
    expect(isChunkBoundary(128, 128)).toBe(true);
    // 非正数粒度 = 中间不让出（同步入口）。
    expect(isChunkBoundary(128, 0)).toBe(false);
    expect(isChunkBoundary(128, -1)).toBe(false);
  });
});

describe("一次导入动作全程分片（SC-024）", () => {
  it("10,000 条：导入 → 增强 → 落盘 → 读取，任务数远超同步实现且结果完整", async () => {
    const contents = buildIcs(10_000);
    const store = await openStore("action.json");
    store.upsertSource({
      id: "local-ics:chain",
      type: "local-ics",
      name: "chain.ics",
      enabled: true,
    });

    // 每个任务之间的间隔就是主线程上一次不中断的时长：让出点由各段决定，
    // 这里把让出本身替换成「量一次 + 真的让出」。
    let last = performance.now();
    const tasks: number[] = [];
    const measuredYield = async () => {
      tasks.push(performance.now() - last);
      await yieldToMain();
      last = performance.now();
    };
    const resetPerPhase = () => {
      last = performance.now();
    };

    await importLocalIcsYielding(
      store,
      { fileName: "chain.ics", contents },
      { yieldToMain: measuredYield },
    );
    resetPerPhase();
    await reEnrichStoreYielding(store, createAppSemanticStack(), {
      yieldToMain: measuredYield,
    });
    resetPerPhase();
    await store.save({ yieldToMain: measuredYield });
    resetPerPhase();

    const run = createTimeSlicedRun(
      enrichedEventsInChunks({
        store,
        enabledSourceIds: new Set(["local-ics:chain"]),
      }),
    );
    run.advance();
    while (run.hasWork()) {
      await measuredYield();
      run.advance();
    }

    // **这里不做墙钟断言**：用例并行跑时机器负载本身就能把某一次任务推到几十
    // 毫秒，而「没有跨帧任务」是基准测量的对象（performance.md §3.5 的方法与数字），
    // 不是能稳定断言的量——这也是仓库既有分片路径的一贯口径（§3.3）。
    // 这里钉的是结构：同步实现只有 5 个任务（解析 / 标准化 / 落库 / 增强 / 落盘 /
    // 读取各一次），分片之后至少两倍以上；具体个数随机器快慢变化，只做下界。
    expect(tasks.length).toBeGreaterThan(10);
    expect(store.listEvents()).toHaveLength(10_000);
  }, 120_000);
});
