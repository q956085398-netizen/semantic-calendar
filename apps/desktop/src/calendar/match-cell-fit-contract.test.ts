// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NARROW_LAYOUT_THRESHOLDS } from "../layout/AppShell";

/**
 * 比赛格对阵块的可容纳性契约（SC-023 / ui-design §10.2、§22）。
 *
 * 为什么需要这条：jsdom 不做布局，「队标 VS 队标 放不下、第二个队标被格子的
 * 裁切边界切掉」这类问题在组件测试里完全测不出来（SC-021 就是这么漏过去的，
 * 见 docs/ui-acceptance.md §5.1）。因此这里把 index.css 里声明的那组系数
 * 拿来做算术：按真实的窗口 → 月历区 → 格子宽度算一遍对阵块需要多宽，
 * 断言它在验收要求的几档尺寸下都放得下，并且窄格子里确实按比例收缩。
 *
 * 与 cell-visual-contract.test.ts 的分工：那份锁「格子必须裁切」（§10.1 对
 * 联赛背景的要求），这份锁「对阵块必须小到不需要裁切」——两者是同一条
 * overflow: hidden 的两面，只有一起看才说明问题解决了。
 *
 * 解析方式与 cell-visual-contract.test.ts 相同（平铺一层规则，够用就好），
 * 因为本文件关心的选择器都是顶层规则，没有 @container / @media 嵌套。
 */

interface CssRule {
  selectors: string[];
  body: string;
}

function parseRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({
      selectors: match[1]
        .split(",")
        .map((selector) => selector.trim())
        .filter(Boolean),
      body: match[2],
    });
  }
  return rules;
}

const CSS = readFileSync(resolve(process.cwd(), "src", "index.css"), "utf8");
const RULES = parseRules(CSS);

function bodyOf(selector: string): string {
  const bodies = RULES.filter((rule) => rule.selectors.includes(selector)).map(
    (rule) => rule.body,
  );
  expect(bodies, `index.css 缺少规则：${selector}`).not.toEqual([]);
  return bodies.join("\n");
}

/** 单边长度值：px 是绝对长度，cqi 是「尺寸查询容器内容盒的百分之一」。 */
interface Length {
  value: number;
  unit: "px" | "cqi";
}

const LENGTH_PATTERN = /^([\d.]+)(px|cqi)$/;

function parseLength(text: string): Length {
  const match = LENGTH_PATTERN.exec(text.trim());
  expect(match, `不是 px / cqi 长度：${text}`).not.toBeNull();
  const [, value, unit] = match as RegExpExecArray;
  return { value: Number(value), unit: unit as Length["unit"] };
}

/**
 * padding 简写的左右分量（本文件只关心水平方向）。
 * 支持 1 / 2 / 3 / 4 值写法；左右不一致时取右侧（对阵块是居中排版，
 * 两侧不相等会让居中基准本身失真，这里顺带断言两者相等）。
 */
function horizontalPaddingOf(source: string, property = "padding"): Length {
  const match = new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(source);
  expect(match, `${property} 应是长度声明：${source}`).not.toBeNull();
  const parts = (match as RegExpExecArray)[1]
    .trim()
    .split(/\s+/)
    .map((part) => parseLength(part));
  expect(
    parts.length,
    `${property} 的分量数应为 1–4：${source}`,
  ).toBeLessThanOrEqual(4);
  const right = parts[parts.length === 1 ? 0 : 1];
  const left = parts.length === 4 ? parts[3] : right;
  expect(left.value, `${property} 左右应一致`).toBe(right.value);
  return right;
}

/** 上下限 + 首选值：收缩靠的就是这个三元组。 */
interface Clamp {
  min: Length;
  preferred: Length;
  max: Length;
}

function clampOf(source: string, property: string): Clamp {
  const match = new RegExp(`${property}:\\s*clamp\\(([^)]+)\\)`).exec(source);
  expect(match, `${property} 应是 clamp(...)：${source}`).not.toBeNull();
  const parts = (match as RegExpExecArray)[1]
    .split(",")
    .map((part) => part.trim());
  expect(parts, `${property} 的 clamp 应有三段`).toHaveLength(3);
  return {
    min: parseLength(parts[0]),
    preferred: parseLength(parts[1]),
    max: parseLength(parts[2]),
  };
}

function resolveLength(length: Length, container: number): number {
  return length.unit === "px" ? length.value : (length.value / 100) * container;
}

function clamped(clamp: Clamp, container: number): number {
  return Math.min(
    Math.max(
      resolveLength(clamp.min, container),
      resolveLength(clamp.preferred, container),
    ),
    resolveLength(clamp.max, container),
  );
}

/**
 * 「VS」在应用字体栈下的宽度系数（px / 字号 px）。
 *
 * 在真实渲染里量的：字号 10px 时 13.39px、8.02px 时 10.74px（含
 * letter-spacing 0.06em），两档比值一致。字体栈是系统字体，Windows 上的
 * WebView2 与验收用的 Chromium 同源，因此这个系数在目标环境里稳定；
 * 断言留了余量（见下），换字体也不会贴边。
 */
const VS_WIDTH_PER_FONT_PX = 1.34;

/**
 * 三栏宽度与栏间距（§2）：与 `.app-shell` 用的是同一批 token，不另抄一份。
 * 抄一份的代价是调参后这里仍然算旧宽度、断言静默通过——正是 SC-023 那类
 * 「界面坏了但测试是绿的」问题。window-size-contract.test.ts 出于同样的理由
 * 直接读 tauri.conf.json。
 */
function pxTokenOf(name: string): number {
  const match = new RegExp(`${name}:\\s*([\\d.]+)px`).exec(bodyOf(":root"));
  expect(match, `:root 缺少 token：${name}`).not.toBeNull();
  return Number((match as RegExpExecArray)[1]);
}

/**
 * 一档窗口宽度 → 月历区宽度。
 *
 * 与 AppShell 同一条算式：`.app-shell` 是三栏网格，四周 padding 与列间距都是
 * `--pane-gap`（两侧 padding 2 份 + 列间 2 份 = 4 份），折叠的栏宽度记 0。
 * 折叠阈值取自 AppShell 导出的常量，与窄窗自动收起用的是同一份。
 */
function monthAreaWidthOf(windowWidth: number): number {
  const sidebarOpen = windowWidth > NARROW_LAYOUT_THRESHOLDS.sidebar;
  const inspectorOpen = windowWidth > NARROW_LAYOUT_THRESHOLDS.inspector;
  const panes =
    (sidebarOpen ? pxTokenOf("--sidebar-width") : 0) +
    (inspectorOpen ? pxTokenOf("--inspector-width") : 0);
  return windowWidth - pxTokenOf("--pane-gap") * 4 - panes;
}

/** 月视图的列数与列间距：同样从 `.month-grid` 的声明里读。 */
function gridColumns(): number {
  const match = /repeat\((\d+),/.exec(bodyOf(".month-grid"));
  expect(match, "`.month-grid` 的列数应写成 repeat(N, …)").not.toBeNull();
  return Number((match as RegExpExecArray)[1]);
}

/** 一档窗口宽度 → 格子宽度：月历区 → N 列 + (N−1) 个列间距。 */
function cellWidthOf(windowWidth: number): number {
  const columns = gridColumns();
  const gap = parseLength(
    /(?:^|[;\s])gap:\s*([^;]+);/.exec(bodyOf(".month-grid"))![1].trim(),
  ).value;
  return (monthAreaWidthOf(windowWidth) - gap * (columns - 1)) / columns;
}

/** 一档尺寸下对阵块的宽度，全部按 index.css 声明的系数算。 */
function rowWidthOf(cellWidth: number): number {
  const cellPaddingX = horizontalPaddingOf(bodyOf(".month-cell")).value;
  // cqi 的解析基准是尺寸查询容器的内容盒，即格子减去左右内边距。
  const container = cellWidth - cellPaddingX * 2;
  const badge = clamped(
    clampOf(bodyOf(".match-cell .mark-sm"), "width"),
    container,
  );
  const gap = clamped(clampOf(bodyOf(".match-cell-teams"), "gap"), container);
  const vsFont = clamped(
    clampOf(bodyOf(".match-cell-vs"), "font-size"),
    container,
  );
  return badge * 2 + gap * 2 + vsFont * VS_WIDTH_PER_FONT_PX;
}

/** 对阵块能用的宽度：格子内容盒减去对阵块自己的左右内边距。 */
function availableWidthOf(cellWidth: number): number {
  const cellPaddingX = horizontalPaddingOf(bodyOf(".month-cell")).value;
  const matchPaddingX = horizontalPaddingOf(bodyOf(".match-cell")).value;
  return cellWidth - cellPaddingX * 2 - matchPaddingX * 2;
}

/** 主窗口的默认与最小宽度：与窗口配置同一份来源（tauri.conf.json）。 */
function mainWindowSizes(): { width: number; minWidth: number } {
  // vitest 以 apps/desktop 为工作目录运行（npm workspace 脚本约定）。
  const config = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src-tauri", "tauri.conf.json"),
      "utf8",
    ),
  ) as { app: { windows: Array<{ width?: number; minWidth?: number }> } };
  const main = config.app.windows[0];
  expect(typeof main.width).toBe("number");
  expect(typeof main.minWidth).toBe("number");
  return { width: main.width as number, minWidth: main.minWidth as number };
}

describe("比赛格对阵块的可容纳性契约（SC-023）", () => {
  it("格子是尺寸查询容器：对阵块能按格子宽度取值（§22）", () => {
    expect(bodyOf(".month-cell")).toContain("container-type: inline-size");
  });

  it("队标 / 间距 / VS / 圆角 / 字号都是随格子收缩的 clamp，不是固定值", () => {
    // 固定值正是 SC-023 的成因：默认窗口下 77.4px 的对阵块放进 57.7px。
    // 圆角与字号也必须跟着缩：16px 的队标配 26px 的圆角与字号会糊成一团。
    for (const [selector, property] of [
      [".match-cell .mark-sm", "width"],
      [".match-cell .mark-sm", "height"],
      [".match-cell .mark-sm", "border-radius"],
      [".match-cell .mark-sm", "font-size"],
      [".match-cell-teams", "gap"],
      [".match-cell-vs", "font-size"],
    ] as const) {
      const clamp = clampOf(bodyOf(selector), property);
      expect(clamp.preferred.unit, `${selector} ${property} 应随容器缩放`).toBe(
        "cqi",
      );
      expect(
        resolveLength(clamp.min, 100),
        `${selector} ${property} 的下限应小于上限`,
      ).toBeLessThan(resolveLength(clamp.max, 100));
    }
  });

  it("验收要求的三档窗口下对阵块都放得下（§26 第 12 项）", () => {
    const { width, minWidth } = mainWindowSizes();
    for (const [label, windowWidth] of [
      [`${width}×760 默认窗口（左右栏展开）`, width],
      [`${minWidth}×560 最小窗口（两侧收成 rail）`, minWidth],
      ["1366 宽窗口", 1366],
    ] as const) {
      const cellWidth = cellWidthOf(windowWidth);
      const row = rowWidthOf(cellWidth);
      const available = availableWidthOf(cellWidth);
      expect(
        row,
        `${label}：格子 ${cellWidth.toFixed(2)}px，对阵块需要 ${row.toFixed(2)}px，只有 ${available.toFixed(2)}px`,
      ).toBeLessThanOrEqual(available);
      // 留一点余量：贴边不算「放得下」，换字体或字号微调就会重新被切。
      expect(available - row, `${label} 的余量`).toBeGreaterThan(1);
    }
  });

  it("最窄的格子（左右栏都展开的最小窗口）也不越出裁切边界", () => {
    // 双栏展开的最小窗口宽度是右栏阈值 + 1（再窄一像素右栏就收起来了）：
    // 这是应用能产生的最窄比赛格。此时下限生效、对阵块不再随格子收缩，
    // 由「居中」退化为「从内容盒左端排起」；但不许越过格子边界（§10.1）。
    const narrowest = NARROW_LAYOUT_THRESHOLDS.inspector + 1;
    const cellWidth = cellWidthOf(narrowest);
    const cellPaddingX = horizontalPaddingOf(bodyOf(".month-cell")).value;
    const matchPaddingX = horizontalPaddingOf(bodyOf(".match-cell")).value;
    const row = rowWidthOf(cellWidth);
    // 起始位置 = 格内边距 + 对阵块内边距（溢出对齐退回 start）。
    expect(
      row + cellPaddingX + matchPaddingX,
      `最窄窗口 ${narrowest}px：格子 ${cellWidth.toFixed(2)}px，对阵块 ${row.toFixed(2)}px`,
    ).toBeLessThanOrEqual(cellWidth);
  });

  it("宽格子回到原设计尺寸：不因为收缩把大窗口也改小", () => {
    // 1680 宽窗口：队标 26px、间距 6px、VS 10px，即 SC-016 原本的固定尺寸。
    expect(rowWidthOf(cellWidthOf(1680))).toBeCloseTo(77.4, 1);
  });
});
