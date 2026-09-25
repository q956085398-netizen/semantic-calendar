// @vitest-environment node
/**
 * 基线：WebCal 增量刷新（app-spec §15「WebCal 增量刷新」）。
 *
 * 两档对应真实世界的两种响应：304（条件请求命中缓存，事件不变）与
 * 200（内容有变，全量替换）。差值就是条件 GET 省下的那一部分——
 * 这是订阅刷新最常见的路径，也是「缓存有失效策略」的测量对象。
 */

import path from "node:path";
import { afterAll, beforeAll, bench, describe } from "vitest";
import type { CalendarSource } from "../data/model";
import { CalendarStore } from "../data/store/calendar-store";
import { refreshWebcalSource } from "../data/webcal/webcal-refresh";
import { WEBCAL_SOURCE_TYPE } from "../data/model";
import { EVENT_COUNTS, buildIcsFixture, buildStoredEvents } from "./fixtures";
import { createTempDir, removeTempDir, seededStore, stubHttp } from "./support";

const URL = "https://calendar.example.com/season.ics";
const SOURCE: CalendarSource = {
  id: "webcal:season",
  type: WEBCAL_SOURCE_TYPE,
  name: "calendar.example.com",
  enabled: true,
  lastSyncStatus: "ok",
  webcal: { url: URL, etag: '"v1"', lastCheckedAt: "2026-01-01T00:00:00Z" },
};

let dir = "";
beforeAll(async () => {
  dir = await createTempDir();
});
afterAll(async () => {
  await removeTempDir(dir);
});

const stores = new Map<number, CalendarStore>();
const bodies = new Map<number, string>();

beforeAll(async () => {
  for (const count of EVENT_COUNTS) {
    stores.set(
      count,
      await seededStore(
        path.join(dir, `webcal-${count}.json`),
        SOURCE,
        buildStoredEvents(count, SOURCE.id),
      ),
    );
    bodies.set(count, buildIcsFixture(count));
  }
});

describe("WebCal 刷新 · 304（条件请求命中缓存）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `缓存 ${count} 条不变`,
      async () => {
        const store = stores.get(count);
        if (store) {
          await refreshWebcalSource(
            store,
            SOURCE.id,
            stubHttp({ status: 304, notModified: true, etag: '"v1"' }),
          );
        }
      },
      { iterations: 5, warmupIterations: 1, time: 0 },
    );
  }
});

describe("WebCal 刷新 · 200（全量替换：解析 + 标准化 + 键差集）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `缓存 ${count} 条更新`,
      async () => {
        const store = stores.get(count);
        if (store) {
          await refreshWebcalSource(
            store,
            SOURCE.id,
            stubHttp({
              status: 200,
              notModified: false,
              body: bodies.get(count) ?? "",
              etag: '"v2"',
            }),
          );
        }
      },
      { iterations: 3, warmupIterations: 1, time: 0 },
    );
  }
});
