// @vitest-environment node
/**
 * 基线：Matcher 批处理（app-spec §15「Matcher 批处理耗时」）。
 *
 * 两档：只跑引擎（识别本身），以及完整增强批处理（引擎 + Resolver + 写增强分区）。
 * 后者是导入 / 刷新后真正发生在主线程上的那一段，也是「大量事件不阻塞 UI」
 * 这条验收的测量对象（见 src/semantic/enrich.ts）。
 */

import path from "node:path";
import { afterAll, beforeAll, bench, describe } from "vitest";
import { asNormalizedEvent, type CalendarSource } from "../data/model";
import { CalendarStore } from "../data/store/calendar-store";
import { NodeFileIO } from "../data/store/node-file-io";
import { createAppSemanticStack } from "../semantic/app-registry";
import { reEnrichStore } from "../semantic/enrich";
import { EVENT_COUNTS, buildStoredEvents } from "./fixtures";
import { createTempDir, removeTempDir } from "./support";

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

const stack = createAppSemanticStack();
const stores = new Map<number, CalendarStore>();
const normalized = new Map<number, ReturnType<typeof asNormalizedEvent>[]>();

beforeAll(async () => {
  for (const count of EVENT_COUNTS) {
    const events = buildStoredEvents(count, SOURCE.id);
    normalized.set(count, events.map(asNormalizedEvent));
    const { store } = await CalendarStore.open(
      new NodeFileIO(),
      path.join(dir, `match-${count}.json`),
    );
    store.upsertSource(SOURCE);
    store.upsertEvents(SOURCE.id, events);
    stores.set(count, store);
  }
});

describe("匹配 · 仅引擎（每条事件跑一遍注册表）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `${count} 条`,
      () => {
        for (const event of normalized.get(count) ?? []) {
          stack.engine.match(event);
        }
      },
      { iterations: 5, warmupIterations: 1, time: 0 },
    );
  }
});

describe("匹配 · 完整增强批处理（引擎 + Resolver + 增强分区）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `${count} 条`,
      () => {
        const store = stores.get(count);
        if (store) {
          reEnrichStore(store, stack);
        }
      },
      { iterations: 3, warmupIterations: 1, time: 0 },
    );
  }
});
