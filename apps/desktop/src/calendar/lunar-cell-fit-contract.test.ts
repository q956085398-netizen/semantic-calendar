// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NARROW_LAYOUT_THRESHOLDS } from "../layout/AppShell";
import {
  lunarDayLabel,
  lunarMonthLabel,
} from "../providers/china/lunar-labels";

/**
 * 农历行的可容纳性契约（SC-010 / ui-design §5.2）。
 *
 * 验收项是「月格文本不挤压主要日期数字」，§5.2 的原话是「字号与字重明显低于
 * 公历日数字，长月名不得挤压或推移日期数字」。这条在 jsdom 里测不出来——
 * jsdom 不做布局（SC-021 的比赛格就是这么漏过去的，见 docs/ui-acceptance.md
 * §5.1）。因此这里把 index.css 里声明的排版参数拿来做算术：按真实的
 * 窗口 → 月历区 → 格子宽度算一遍最长的农历文本要占多宽，断言它在桌面窗口
 * 能产生的最窄格子里也放得下；并断言两行本来就各自成盒（换行 / 省略是兜底，
 * 正常路径根本不需要它们）。
 *
 * 算术之外还做过一次真实渲染的对照（临时装置，没有进仓库，与
 * docs/ui-acceptance.md §5.1 的复检同一办法）：无头 Chromium 加载真实
 * index.css，按真实的月历区宽度铺 7 列 `.month-cell`，量到的数字是——最窄的
 * 67.56px 格子里「闰十一月」占 44px、可用 47.56px，没有触发省略号；同一格子
 * 里把农历行从「初九」换成「闰十一月」，日期数字的盒子一律是 47.56 × 18px，
 * 逐像素相同，字重 600 对 400。这条断言与那次测量互相印证：测量能证明当下
 * 这一版的对不对，这条契约能拦住以后改坏。
 *
 * 与 calendar/match-cell-fit-contract.test.ts 的分工：那份锁「对阵块必须小到
 * 不需要裁切」（§10.2），这份锁「农历行必须小到不需要挤走日期数字」（§5.2）。
 * 读取方式与它相同（窗口宽度取自 tauri.conf.json，栏宽 / 间距 / 内边距 / 字号
 * 取自 index.css，折叠阈值取自 AppShell，都不另抄一份数值）。
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

/** px 长度声明：本文件只关心 px（农历行没有跟着容器缩放的 clamp）。 */
function pxOf(source: string, property: string): number {
  const match = new RegExp(
    `(?:^|[;\\s])${property}:\\s*([\\d.]+)px(?:[;\\s]|$)`,
  ).exec(source);
  expect(match, `${property} 应是 px 长度声明：${source}`).not.toBeNull();
  return Number((match as RegExpExecArray)[1]);
}

/** padding 简写的左右分量（1 / 2 / 3 / 4 值写法，左右应一致）。 */
function horizontalPaddingOf(source: string): number {
  const match = /(?:^|[;\s])padding:\s*([^;]+);/.exec(source);
  expect(match, `padding 应是长度声明：${source}`).not.toBeNull();
  const parts = (match as RegExpExecArray)[1]
    .trim()
    .split(/\s+/)
    .map((part) => pxOf(`padding: ${part};`, "padding"));
  // 分量数超过 4 的写法无效：与其按位置猜一个值，不如直接红。
  expect(
    parts.length,
    `padding 的分量数应为 1–4：${source}`,
  ).toBeLessThanOrEqual(4);
  const right = parts[parts.length === 1 ? 0 : 1];
  const left = parts.length === 4 ? parts[3] : right;
  expect(left, "padding 左右应一致").toBe(right);
  return right;
}

/** 三栏宽度与栏间距：与 `.app-shell` 用的是同一批 token。 */
function pxTokenOf(name: string): number {
  const match = new RegExp(`${name}:\\s*([\\d.]+)px`).exec(bodyOf(":root"));
  expect(match, `:root 缺少 token：${name}`).not.toBeNull();
  return Number((match as RegExpExecArray)[1]);
}

/**
 * 一档窗口宽度 → 月历区宽度（与 AppShell 同一条算式：四周 padding 与列间距
 * 都是 `--pane-gap`，折叠的栏记 0）。
 */
function monthAreaWidthOf(windowWidth: number): number {
  const sidebarOpen = windowWidth > NARROW_LAYOUT_THRESHOLDS.sidebar;
  const inspectorOpen = windowWidth > NARROW_LAYOUT_THRESHOLDS.inspector;
  const panes =
    (sidebarOpen ? pxTokenOf("--sidebar-width") : 0) +
    (inspectorOpen ? pxTokenOf("--inspector-width") : 0);
  return windowWidth - pxTokenOf("--pane-gap") * 4 - panes;
}

/** 一档窗口宽度 → 格子宽度（月历区 → N 列 + (N−1) 个列间距）。 */
function cellWidthOf(windowWidth: number): number {
  const grid = bodyOf(".month-grid");
  const columns = /repeat\((\d+),/.exec(grid);
  expect(columns, "`.month-grid` 的列数应写成 repeat(N, …)").not.toBeNull();
  const gap = pxOf(grid, "gap");
  return (
    (monthAreaWidthOf(windowWidth) - gap * (Number(columns![1]) - 1)) /
    Number(columns![1])
  );
}

/** 农历行可用的宽度：格子内容盒（格子减去 `.month-cell` 的左右内边距）。 */
function lunarLineWidthOf(windowWidth: number): number {
  return (
    cellWidthOf(windowWidth) - horizontalPaddingOf(bodyOf(".month-cell")) * 2
  );
}

/** 主窗口的默认与最小宽度：与窗口配置同一份来源（tauri.conf.json）。 */
function mainWindowSizes(): { width: number; minWidth: number } {
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

/**
 * 一个汉字在应用字体栈下的宽度系数（px / 字号 px）。
 *
 * 汉字是全角字形，前进宽度就是 1em，这是字形设计的定义而不是巧合——实测
 * 对得上：无头 Chromium 加载应用字体栈（`:root` 的 `Inter, "Segoe UI",
 * "PingFang SC", "Microsoft YaHei", system-ui`）量「闰十一月」，11px 下
 * 44.00px（每字 11.00px）、22px 下 88.00px（每字 22.00px），与字号线性。
 * Inter 不含汉字，实际落到系统中日韩字体，仍是全角。
 *
 * 前提由下面那条字体栈断言守住：字体栈里必须还有中日韩字族，否则汉字会落到
 * 谁都不认识的兜底字形上，这个系数就不再成立（而测试仍然绿）。
 */
const CJK_WIDTH_PER_FONT_PX = 1;

/**
 * 最长的月格农历文本，逐字取自真实的文案函数——不手写一个「闰十一月」，
 * 改文案（比如十一月改叫冬月）时这里跟着变，宽度额度不会停在旧值上。
 * 月格文本只有两种来源（初一写月名，其余写日名），因此取两边的最大值即可。
 */
function longestLunarCellText(): string {
  const texts: string[] = [];
  for (let month = 1; month <= 12; month += 1) {
    for (const isLeapMonth of [false, true]) {
      texts.push(lunarMonthLabel(month, isLeapMonth));
    }
  }
  for (let day = 1; day <= 30; day += 1) {
    texts.push(lunarDayLabel(day));
  }
  return texts.reduce((longest, text) =>
    text.length > longest.length ? text : longest,
  );
}

describe("农历行的可容纳性契约（SC-010 / ui-design §5.2）", () => {
  it("农历行是日期数字下方的一行：两行各自成盒，不争同一行空间（§5.2）", () => {
    const cell = bodyOf(".month-cell");
    expect(cell).toMatch(/display:\s*flex/);
    expect(cell).toMatch(/flex-direction:\s*column/);
    // 日期数字自带字号与行高：它的行盒高度由自己决定，与农历行写多长无关。
    expect(bodyOf(".cell-day")).toMatch(/font-size:/);
    expect(bodyOf(".cell-day")).toMatch(/line-height:/);
    // 农历行留在流式排版里（不绝对定位）：它不会压到数字上，只能往下排。
    expect(bodyOf(".cell-lunar")).not.toMatch(/position:\s*absolute/);
  });

  it("长月名既不换行也不撑宽：溢出交给省略号兜底（§5.2）", () => {
    const lunar = bodyOf(".cell-lunar");
    expect(lunar).toMatch(/white-space:\s*nowrap/);
    expect(lunar).toMatch(/overflow:\s*hidden/);
    expect(lunar).toMatch(/text-overflow:\s*ellipsis/);
  });

  it("字号与字重明显低于公历日数字（§5.2）", () => {
    const daySize = pxOf(bodyOf(".cell-day"), "font-size");
    const lunarSize = pxOf(bodyOf(".cell-lunar"), "font-size");
    expect(
      lunarSize,
      `日期数字 ${daySize}px / 农历 ${lunarSize}px`,
    ).toBeLessThan(daySize);
    // 「明显」的口径：农历不超过日期数字的八成（当前 11 / 15 ≈ 73%）。
    expect(lunarSize).toBeLessThanOrEqual(daySize * 0.8);

    // 字重：日期数字自带 600，农历行自己不设字重，祖先链上也不设——因此农历
    // 渲染出来就是初始值 400（真实渲染里量到的是 600 / 400）。链上的选择器
    // 取自真实 DOM（`.month-view` → `.month-grid` → `.month-week` →
    // `.month-cell`，加上月历区自身的 `.pane-calendar`）；新增一层带字重的
    // 容器不在扫描范围内，需要时就加进这张表。
    const dayWeight = Number(
      /(?:^|[;\s])font-weight:\s*(\d+)/.exec(bodyOf(".cell-day"))![1],
    );
    expect(dayWeight).toBeGreaterThanOrEqual(600);
    expect(bodyOf(".cell-lunar")).not.toMatch(/(?:^|[;\s])font-weight:/);
    for (const ancestor of [
      ".pane-calendar",
      ".month-view",
      ".month-grid",
      ".month-week",
      ".month-cell",
    ]) {
      expect(bodyOf(ancestor), `${ancestor} 不应给农历行加字重`).not.toMatch(
        /(?:^|[;\s])font-weight:/,
      );
    }
  });

  it("字体栈里留着中日韩字族：全角系数（1 字 = 1em）才有依据", () => {
    // 上面那条宽度算术用了「一个汉字 = 1em」。Inter / Segoe UI 都没有汉字，
    // 汉字实际由字体栈里的中日韩字族提供（ui-design §21：Windows 用
    // Microsoft YaHei、macOS 用 PingFang SC）；把这两个字族去掉，汉字会落到
    // 兜底字形上，宽度不再是 1em，而算术仍然绿。
    expect(bodyOf(":root")).toMatch(/PingFang SC|Microsoft YaHei/);
  });

  it("最长的农历文本（闰十一月）在桌面窗口能产生的最窄格子里也放得下（§5.2）", () => {
    const longest = longestLunarCellText();
    // 四个字是文案词汇表的上限（「闰」加三字月名）。范围内确实出现这一档：
    // 2033 年闰十一月（lunar.test.ts 钉住了 leapMonthOf(2033) === 11，月格在
    // 闰十一月初一写「闰十一月」）。改文案若把上限推高，这条会红，提醒重新
    // 核对月格的宽度额度——这正是它要的：额度跟着文案走，不允许悄悄变窄。
    expect(
      longest,
      `最长的月格农历文本应仍是四个字（当前：「${longest}」）`,
    ).toHaveLength(4);

    const lunarSize = pxOf(bodyOf(".cell-lunar"), "font-size");
    const needed = longest.length * lunarSize * CJK_WIDTH_PER_FONT_PX;

    const { width, minWidth } = mainWindowSizes();
    for (const [label, windowWidth] of [
      [`最小窗口 ${minWidth}×560（两侧收成 rail）`, minWidth],
      [`默认窗口 ${width}（左右栏展开）`, width],
      // 双栏都展开的最小窗口宽度 = 右栏折叠阈值 + 1。桌面窗口范围内（最小
      // 宽度 820 落在折叠阈值以内）这是格子最窄的一档：再窄一像素右栏就收成
      // rail，格子反而变宽。（无最小宽度约束的浏览器预览可以更窄，那种情形
      // 由省略号兜底，日期数字的行盒不受影响。）
      [
        `双栏展开的最窄窗口 ${NARROW_LAYOUT_THRESHOLDS.inspector + 1}`,
        NARROW_LAYOUT_THRESHOLDS.inspector + 1,
      ],
    ] as const) {
      const available = lunarLineWidthOf(windowWidth);
      expect(
        needed,
        `${label}：格子 ${cellWidthOf(windowWidth).toFixed(1)}px，农历行可用 ${available.toFixed(1)}px，最长文本「${longest}」需要 ${needed.toFixed(1)}px`,
      ).toBeLessThanOrEqual(available);
      // 留一点余量：贴边不算「放得下」，字距或内边距微调就会开始省字。
      expect(available - needed, `${label} 的余量`).toBeGreaterThan(1);
    }
  });
});
