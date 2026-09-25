// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WEBCAL_SOURCE_TYPE, type CalendarSource } from "../data/model";
import { formatDateTime } from "../format/time";
import {
  describeSourceRemoval,
  sourceColor,
  sourceStatusText,
} from "./source-display";

/**
 * 来源状态文案与识别色（SC-018 验收「对网络源显示最近刷新状态」/ SRC-003）。
 *
 * 这条验收此前只有侧栏的间接证据（刷新失败与 304 两条 App 集成用例），
 * 「最近刷新状态」的其余取值——尚未刷新 / 上次成功 / 刷新中 / 已停用——以及
 * 它们的组合没有任何守卫：改坏一处措辞不会有测试变红。这里把取值域逐条钉住，
 * 并锁住三条口径：
 *
 * - 「上次成功」写的是**上次成功**的时间，失败时它也必须在（失败时用户更
 *   需要知道缓存有多旧，SRC-004）；
 * - 侧栏与设置页共用这一个函数，因此两处说法不会漂移（App 集成里另有一条
 *   用例比对两处渲染出来的文字完全相同）；
 * - 识别色只由来源 id 派生，且四支色都真的取得到——增删来源不会改变既有
 *   来源的颜色，调色板也不会退化成一支。
 *
 * 已知边界：`lastSyncError` 在应用自己的写入路径上与 `error` 一起出现
 * （`data/webcal/webcal-refresh.ts` 同时写这两个字段），因此「有 error 标记但
 * 没有原因」只可能来自手改或旧版本的快照，此时不写一句没有内容的「刷新失败」
 * 空话——宁可少一行，也不造一条不可解释的状态。这条边界有单独的用例。
 */

const SRC_ROOT = resolve(process.cwd(), "src");

/** 一个订阅来源；用例只覆盖自己关心的字段。 */
function webcalSource(overrides: Partial<CalendarSource> = {}): CalendarSource {
  return {
    id: "webcal:https://calendar.example.com/feed.ics",
    type: WEBCAL_SOURCE_TYPE,
    name: "calendar.example.com/feed.ics",
    enabled: true,
    webcal: { url: "https://calendar.example.com/feed.ics" },
    ...overrides,
  };
}

/** 与 index.css 的 --source-* 一一对应；取值顺序即调色板顺序。 */
const SOURCE_COLOR_TOKENS = [
  "var(--source-personal)",
  "var(--source-sport)",
  "var(--source-solar)",
  "var(--source-holiday)",
];

describe("来源状态文案（SC-018 验收 / SRC-003）", () => {
  it("从未成功刷新过的来源写明「尚未刷新」", () => {
    expect(
      sourceStatusText(webcalSource({ lastSyncStatus: "never" }), false),
    ).toBe("尚未刷新");
    // 旧快照里没有状态字段时给同一句话，不出现空白状态行。
    expect(sourceStatusText(webcalSource(), false)).toBe("尚未刷新");
  });

  it("成功刷新后写「上次成功 + 本地时间」，时间经本地格式化", () => {
    const at = "2026-09-25T10:05:00";
    expect(
      sourceStatusText(
        webcalSource({ lastSyncStatus: "ok", lastSyncAt: at }),
        false,
      ),
    ).toBe(`上次成功 ${formatDateTime(at)}`);
  });

  it("刷新中与其它状态并列，顺序固定为「刷新中 → 已停用 → 失败 → 上次成功」", () => {
    const at = "2026-09-25T10:05:00";
    expect(
      sourceStatusText(
        webcalSource({ lastSyncStatus: "ok", lastSyncAt: at }),
        true,
      ),
    ).toBe(`刷新中… · 上次成功 ${formatDateTime(at)}`);

    // 四段同时成立时才是真正的顺序证据：停用的来源也可以正在手动刷新、
    // 且上一次是失败的（用户点了刷新就想看到“正在重试”）。
    expect(
      sourceStatusText(
        webcalSource({
          enabled: false,
          lastSyncStatus: "error",
          lastSyncError: "连接超时",
          lastSyncAt: at,
        }),
        true,
      ),
    ).toBe(
      `刷新中… · 已停用 · 刷新失败：连接超时 · 上次成功 ${formatDateTime(at)}`,
    );
  });

  it("失败时原因与上次成功时间同时出现（缓存有多旧同样是状态）", () => {
    const at = "2026-09-25T10:05:00";
    expect(
      sourceStatusText(
        webcalSource({
          lastSyncStatus: "error",
          lastSyncError: "连接超时",
          lastSyncAt: at,
        }),
        false,
      ),
    ).toBe(`刷新失败：连接超时 · 上次成功 ${formatDateTime(at)}`);
  });

  it("停用是用户选择而不是失败：与刷新状态并列说明", () => {
    const at = "2026-09-25T10:05:00";
    expect(
      sourceStatusText(
        webcalSource({
          enabled: false,
          lastSyncStatus: "error",
          lastSyncError: "连接超时",
          lastSyncAt: at,
        }),
        false,
      ),
    ).toBe(`已停用 · 刷新失败：连接超时 · 上次成功 ${formatDateTime(at)}`);
  });

  it("有 error 标记但没有原因时不写空话（手改快照的边界）", () => {
    const text = sourceStatusText(
      webcalSource({ lastSyncStatus: "error" }),
      false,
    );
    expect(text).toBe("");
    expect(text).not.toContain("刷新失败");
    // 同一份来源停用后仍有可读说法：少的是说不出内容的那半句。
    expect(
      sourceStatusText(
        webcalSource({ enabled: false, lastSyncStatus: "error" }),
        false,
      ),
    ).toBe("已停用");
  });
});

describe("删除确认文案（SRC-002）", () => {
  it("订阅与本地导入各有说法：导入来源不会被说成订阅", () => {
    expect(describeSourceRemoval(webcalSource({ name: "feed.ics" }))).toBe(
      "删除订阅「feed.ics」及其全部事件？",
    );
    expect(
      describeSourceRemoval(
        webcalSource({
          id: "local:team.ics",
          type: "local-ics",
          name: "team.ics",
          webcal: undefined,
        }),
      ),
    ).toBe("删除导入来源「team.ics」及其全部事件？");
  });
});

describe("来源识别色（SC-006 / SRC-003）", () => {
  it("取值被钉住：改派生规则会让已导入来源换色，那是一次有意的决定", () => {
    // 两个真实形态的 id（订阅地址派生 / 本地文件名派生）。改动哈希或取模
    // 会让所有既有来源一起换色——用户看得见，因此不该无声发生。
    expect(sourceColor("webcal:https://calendar.example.com/feed.ics")).toBe(
      "var(--source-personal)",
    );
    expect(sourceColor("local:team.ics")).toBe("var(--source-holiday)");
  });

  it("只由来源 id 决定：同一 id 每次都是同一支色", () => {
    const id = "webcal:https://calendar.example.com/feed.ics";
    expect(sourceColor(id)).toBe(sourceColor(id));
  });

  it("四支色都取得到：调色板没有退化成一支", () => {
    const tokens = new Set(
      Array.from({ length: 400 }, (_, index) => sourceColor(`source-${index}`)),
    );
    expect([...tokens].sort()).toEqual([...SOURCE_COLOR_TOKENS].sort());
  });

  it("四支色都在 index.css 里定义（改名会让来源圆点变透明）", () => {
    const css = readFileSync(resolve(SRC_ROOT, "index.css"), "utf8");
    for (const token of SOURCE_COLOR_TOKENS) {
      const name = token.slice("var(".length, -1);
      expect(css).toMatch(new RegExp(`${name}\\s*:`));
    }
  });
});
