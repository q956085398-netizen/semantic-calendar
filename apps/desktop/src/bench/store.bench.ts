// @vitest-environment node
/**
 * 基线：本地快照的落盘与读取（app-spec §15「冷启动 / 空闲资源」的数据层部分）。
 *
 * 冷启动里唯一与事件量相关的一段就是「读快照 → 收窄 → 建索引」，
 * 这里把它单独量出来；窗口与 WebView 的启动开销在桌面侧另测
 * （docs/performance.md）。
 */

import path from "node:path";
import { afterAll, beforeAll, bench, describe } from "vitest";
import type { CalendarSource } from "../data/model";
import { CalendarStore } from "../data/store/calendar-store";
import { NodeFileIO } from "../data/store/node-file-io";
import { EVENT_COUNTS, buildStoredEvents } from "./fixtures";
import { createTempDir, removeTempDir, seededStore } from "./support";

const SOURCE: CalendarSource = {
  id: "local-ics:perf",
  type: "local-ics",
  name: "perf.ics",
  enabled: true,
};

let dir = "";
beforeAll(async () => {
  dir = await createTempDir();
});
afterAll(async () => {
  await removeTempDir(dir);
});

const stores = new Map<number, CalendarStore>();
const paths = new Map<number, string>();

beforeAll(async () => {
  for (const count of EVENT_COUNTS) {
    const filePath = path.join(dir, `store-${count}.json`);
    paths.set(count, filePath);
    stores.set(
      count,
      await seededStore(filePath, SOURCE, buildStoredEvents(count, SOURCE.id)),
    );
  }
});

describe("快照落盘（序列化 + 原子写）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `${count} 条`,
      async () => {
        await stores.get(count)?.save();
      },
      { iterations: 3, warmupIterations: 1, time: 0 },
    );
  }
});

describe("快照读取（读取 + 版本校验 + 逐条收窄）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `${count} 条`,
      async () => {
        await CalendarStore.open(
          new NodeFileIO(),
          paths.get(count) ?? "missing.json",
        );
      },
      { iterations: 3, warmupIterations: 1, time: 0 },
    );
  }
});

describe("读取模型（listEnrichedEvents：排序 + 克隆）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `${count} 条`,
      () => {
        stores.get(count)?.listEnrichedEvents();
      },
      { iterations: 5, warmupIterations: 1, time: 0 },
    );
  }
});
