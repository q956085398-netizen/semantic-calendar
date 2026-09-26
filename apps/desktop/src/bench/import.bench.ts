// @vitest-environment node
/**
 * 基线：本地 ICS 导入（app-spec §15「1,000 / 10,000 事件导入」）。
 *
 * 两段分开测，因为它们的失效方式不同：解析是纯文本处理，落库是
 * 键计算 + 快照写入；合在一起只能看到一个总数，无法判断该优化哪一段。
 */

import path from "node:path";
import { afterAll, beforeAll, bench, describe } from "vitest";
import { importLocalIcs } from "../data/import/import-local-ics";
import { CalendarStore } from "../data/store/calendar-store";
import { NodeFileIO } from "../data/store/node-file-io";
import { parseIcsCalendar } from "../ics/parse-ics";
import { createAppSemanticStack } from "../semantic/app-registry";
import { reEnrichStoreYielding } from "../semantic/enrich";
import { EVENT_COUNTS, buildIcsFixture } from "./fixtures";
import { createTempDir, removeTempDir } from "./support";

let dir = "";
beforeAll(async () => {
  dir = await createTempDir();
});
afterAll(async () => {
  await removeTempDir(dir);
});

/** 固定输入在测量之外生成：基准里不应包含夹具构造。 */
const ICS_BY_COUNT = new Map(
  EVENT_COUNTS.map((count) => [count, buildIcsFixture(count)] as const),
);

describe("导入 · 解析（ICS 文本 → 事件数组）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `${count} 条`,
      () => {
        parseIcsCalendar(ICS_BY_COUNT.get(count) ?? "");
      },
      { iterations: 5, warmupIterations: 1, time: 0 },
    );
  }
});

describe("导入 · 整条链路（解析 + 标准化 + 落库）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `${count} 条`,
      async () => {
        const { store } = await CalendarStore.open(
          new NodeFileIO(),
          path.join(dir, `import-${count}.json`),
        );
        await importLocalIcs(store, {
          fileName: `perf-${count}.ics`,
          contents: ICS_BY_COUNT.get(count) ?? "",
        });
      },
      { iterations: 3, warmupIterations: 1, time: 0 },
    );
  }
});

describe("导入 · 应用处理一次导入的总时长（导入 + 增强 + 读模型 + 落盘）", () => {
  for (const count of EVENT_COUNTS) {
    bench(
      `${count} 条`,
      async () => {
        // 与 App.tsx 的导入处理器同序：导入 → 分片增强 → 重建读模型 → 落盘。
        // 分片增强把一次长阻塞拆成若干任务，这里量的是整体时长；单片时长
        // 由 ENRICH_CHUNK_SIZE 决定（见 semantic/enrich.ts 的说明）。
        const { store } = await CalendarStore.open(
          new NodeFileIO(),
          path.join(dir, `app-import-${count}.json`),
        );
        await importLocalIcs(store, {
          fileName: `perf-${count}.ics`,
          contents: ICS_BY_COUNT.get(count) ?? "",
        });
        await reEnrichStoreYielding(store, createAppSemanticStack());
        store.listEnrichedEvents();
        await store.save();
      },
      { iterations: 3, warmupIterations: 1, time: 0 },
    );
  }
});
