// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NARROW_LAYOUT_THRESHOLDS } from "./AppShell";

/**
 * 窗口尺寸契约（SC-002 / SC-021）：两端都用真实来源算，不另抄一份数值。
 *
 * - 最小尺寸（SC-002）：窗口缩到允许的最小宽度时，两侧面板都已自动收起，
 *   月历主体仍然完整，折叠栏以悬浮按钮形式提供临时展开（ui-design §23）；
 * - 默认尺寸（SC-021 / ui-design §26 第 4 项）：默认窗口下三栏都展开，且月历区
 *   比两侧栏加起来还宽、占窗口宽度的一半以上——「主月历占据主要空间」与
 *   §2「优先保证中央月历空间」的可执行形式。这一条原本只有人工记录（§26 第 4 项
 *   的自动证据为空），而它依赖 tauri.conf.json 的窗口宽度与 index.css 的栏宽
 *   token 同时成立。
 *
 * 口径说明：§2 给的三栏比例是**建议值**（中央 62%–66%），当前固定 token 在默认
 * 窗口下是 52.5%，并不落在建议区间里；§26 第 4 项的验收措辞是「占据主要空间」，
 * 这里锁的是后者（大于两侧之和 + 大于窗口一半），不是 §2 的建议比例——
 * 要改成建议比例是调整栏宽 token 的独立决定，见 docs/ui-acceptance.md §4 第 4 项。
 *
 * 这条契约跨 TypeScript、tauri.conf.json 与 index.css 三个文件，容易在调参时
 * 被破坏（例如把最小宽度调大却没有同步阈值，或把侧栏调宽到月历不再是主区域），
 * 所以在这里锁住。宽窗一侧的边界（比赛对阵块放得下）另有
 * calendar/match-cell-fit-contract.test.ts。
 */

interface MainWindowConfig {
  label?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
}

function mainWindowConfig(): MainWindowConfig {
  // vitest 以 apps/desktop 为工作目录运行（npm workspace 脚本约定）。
  const configPath = resolve(process.cwd(), "src-tauri", "tauri.conf.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    app: { windows: MainWindowConfig[] };
  };
  const main = config.app.windows[0];
  expect(main.label).toBe("main");
  return main;
}

/** index.css 原文：三栏骨架与栏宽 token 的声明都在这里。 */
const CSS = readFileSync(resolve(process.cwd(), "src", "index.css"), "utf8");

/**
 * 栏宽 / 间距 token 的取值。只认带 px 值的声明，因此 `var(--sidebar-width)`
 * 这类引用不会被误数；并要求恰好声明一次——两套主题共用同一套三栏尺寸，
 * 哪天某个主题单独改了栏宽，「月历是主区域」在两套主题下就不再是同一件事。
 */
function pxTokenOf(name: string): number {
  const declarations = [
    ...CSS.matchAll(new RegExp(`${name}:\\s*([\\d.]+)px`, "g")),
  ];
  expect(declarations, `index.css 应恰好声明一次 ${name}`).toHaveLength(1);
  return Number(declarations[0][1]);
}

/**
 * 选择器的声明体（先去掉注释再平铺一层规则，够用就好——与
 * cell-visual-contract / match-cell-fit-contract 同一读法）；找不到规则直接红，
 * 避免契约在选择器改名后空转。选择器列表按逗号拆开逐项比对，因此
 * `.a, .b { … }` 这类合并写法也会命中，而 `.app-shell.sidebar-collapsed` 这种
 * 带修饰的选择器不会被误当成 `.app-shell`。
 */
function bodyOf(selector: string): string {
  const bodies = [
    ...CSS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ]
    .filter((match) =>
      match[1]
        .split(",")
        .map((part) => part.trim())
        .includes(selector),
    )
    .map((match) => match[2]);
  expect(bodies, `index.css 缺少规则：${selector}`).not.toEqual([]);
  return bodies.join("\n");
}

/**
 * 骨架四周让出的宽度：左右两个 padding + 两个列间距，四份都是 --pane-gap。
 * 与 `.app-shell` 的声明同源（同 match-cell-fit-contract 的算式），
 * 调 token 后这里不会拿着旧数值静默通过。
 */
function shellInsetOf(): number {
  const body = bodyOf(".app-shell");
  for (const property of ["gap", "padding"]) {
    const match = new RegExp(
      `(?:^|[;\\s])${property}:\\s*var\\((--[a-z-]+)\\)`,
    ).exec(body);
    expect(
      match,
      `.app-shell 的 ${property} 应整份引用间距 token：${body}`,
    ).not.toBeNull();
    expect((match as RegExpExecArray)[1]).toBe("--pane-gap");
  }
  return pxTokenOf("--pane-gap") * 4;
}

/** 一档窗口宽度 → 月历区宽度（三栏都展开时）。 */
function monthAreaWidthOf(windowWidth: number): number {
  return (
    windowWidth -
    shellInsetOf() -
    pxTokenOf("--sidebar-width") -
    pxTokenOf("--inspector-width")
  );
}

describe("窗口最小尺寸契约（SC-002）", () => {
  it("最小宽度落在侧栏折叠阈值内：最窄时月历独占整宽", () => {
    const { minWidth } = mainWindowConfig();
    expect(typeof minWidth).toBe("number");
    expect(minWidth as number).toBeLessThanOrEqual(
      NARROW_LAYOUT_THRESHOLDS.sidebar,
    );
  });

  it("最小高度足够放下月历表头与六行网格", () => {
    const { minHeight } = mainWindowConfig();
    expect(typeof minHeight).toBe("number");
    // 月视图按 6 行日期格布局，低于 480 会挤压日期格内容（ui-design §5）。
    expect(minHeight as number).toBeGreaterThanOrEqual(480);
  });

  it("折叠阈值本身有序：右栏先于左栏收起（§23 顺序）", () => {
    expect(NARROW_LAYOUT_THRESHOLDS.sidebar).toBeLessThan(
      NARROW_LAYOUT_THRESHOLDS.inspector,
    );
  });
});

describe("默认窗口尺寸契约（SC-021 / ui-design §26 第 4 项）", () => {
  it("默认窗口下三栏都展开，月历比两侧栏加起来还宽、且占窗口一半以上（§26 第 4 项）", () => {
    const { width } = mainWindowConfig();
    expect(typeof width).toBe("number");
    const windowWidth = width as number;
    // 默认尺寸必须落在折叠阈值之外，否则「默认三栏」这个前提本身就不成立。
    expect(windowWidth).toBeGreaterThan(NARROW_LAYOUT_THRESHOLDS.inspector);

    const sidebar = pxTokenOf("--sidebar-width");
    const inspector = pxTokenOf("--inspector-width");
    const monthArea = monthAreaWidthOf(windowWidth);
    // 「占据主要空间」的可执行口径。比两侧栏之和还宽这一条已经蕴含「比任一栏都宽」，
    // 因此不再单列那两条断言。
    const numbers = `默认窗口 ${windowWidth}px：月历区 ${monthArea}px，侧栏 ${sidebar}px，详情栏 ${inspector}px`;
    expect(monthArea, numbers).toBeGreaterThan(sidebar + inspector);
    expect(monthArea, numbers).toBeGreaterThan(windowWidth / 2);
  });

  it("骨架满高，月历区不给自己留内边距与边框（§2 优先保证中央月历空间）", () => {
    // 满高：窗口高度就是三栏高度，月历不额外让出上下空间。
    expect(bodyOf(".app-shell")).toMatch(/(?:^|[;\s])height:\s*100vh/);
    // 月历区把整列交给月视图网格。两侧栏各自有内边距 / 边框——这两条对照是为了
    // 让「月历区没有」成为一个真实差异，而不是读取器什么都没读到（选择器改名
    // 已经由 bodyOf 自己的断言拦住了）。
    expect(bodyOf(".pane-calendar")).not.toMatch(
      /(?:^|[;\s])padding(-[a-z]+)?:/,
    );
    expect(bodyOf(".pane-calendar")).not.toMatch(
      /(?:^|[;\s])border(-(width|style|color))?:/,
    );
    expect(bodyOf(".pane-sidebar")).toMatch(/(?:^|[;\s])padding:/);
    expect(bodyOf(".pane-inspector")).toMatch(/(?:^|[;\s])border:/);
  });
});
