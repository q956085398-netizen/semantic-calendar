// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 日期格语义视觉的样式契约（SC-013 / ui-design §7.2、§8.2、§9.1、§10.1、§16）。
 *
 * 这几条验收项在 jsdom 里测不出来——jsdom 不做布局、也不加载样式表：
 * 「休 / 补大字被格子裁切」「Logo 不溢出格子」「文字压在背景之上」
 * 全部取决于真实的裁切与层叠行为。因此这里直接对 index.css 断言，
 * 把只能靠肉眼评审的规则变成可执行的守卫（与 ui-boundary、
 * window-size-contract 同一条办法）。
 *
 * 解析方式够用就好：本文件没有 @media 等嵌套规则，也没有注释内含花括号，
 * 因此去掉注释后按「一层规则」平铺解析即可，不需要引入 CSS 解析器。
 */

interface CssRule {
  /** 选择器列表，已按逗号拆分并去除空白。 */
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

/** 取某个选择器自身规则体的合并结果（同名选择器可能分散在多处）。 */
function bodyOf(selector: string): string {
  const bodies = parseRules(CSS)
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.body);
  expect(bodies, `index.css 缺少规则：${selector}`).not.toEqual([]);
  return bodies.join("\n");
}

describe("日期格语义视觉的样式契约（SC-013）", () => {
  it("格子是裁切容器：休 / 补大字与联赛背景都裁在格内（§7.2 / §10.1）", () => {
    expect(bodyOf(".month-cell")).toContain("overflow: hidden");
    expect(bodyOf(".cell-glyph")).toContain("position: absolute");
    expect(bodyOf(".match-cell-bg")).toContain("position: absolute");
    // 背景图铺满格子，由格子的裁切兜住素材尺寸（§22 布局决定 Logo 如何显示）。
    expect(bodyOf(".cell-backdrop")).toContain("overflow: hidden");
    expect(bodyOf(".cell-backdrop-image")).toContain("object-fit: cover");
  });

  it("大字落在右下、半透明、不吃鼠标事件（§7.2 / §8.2）", () => {
    const glyph = bodyOf(".cell-glyph");

    expect(glyph).toContain("right:");
    expect(glyph).toContain("bottom:");
    expect(glyph).toContain("pointer-events: none");
    // 半透明：语义色混入透明，而不是实心色块。
    expect(glyph).toContain("color-mix");
    expect(glyph).toContain("transparent");
  });

  it("文字与比赛块都压在背景层之上：多重语义下日期数字仍可读（§1 原则 5）", () => {
    for (const selector of [
      ".cell-day",
      ".cell-lunar",
      ".cell-semantic",
      ".cell-events",
      ".cell-solar-term",
      ".match-cell",
    ]) {
      expect(bodyOf(selector)).toContain("z-index: 1");
    }
    for (const selector of [
      ".cell-glyph",
      ".cell-backdrop",
      ".match-cell-bg",
    ]) {
      expect(bodyOf(selector)).toContain("z-index: 0");
    }
  });

  it("休假 / 补班底色叠加在格底板上，选中与 hover 不覆盖它（§17）", () => {
    expect(bodyOf('.month-cell[data-cell-backdrop="holiday"]')).toContain(
      "color-mix",
    );
    // 格子先把自己的底板命名成 --cell-surface，各状态规则再从这个值派生，
    // 而不是每条规则各写一遍回退链（假期底色因此不会被状态覆盖掉）。
    expect(bodyOf(".month-cell")).toContain(
      "--cell-surface: var(--cell-tint, var(--bg-cell))",
    );
    for (const selector of [
      ".month-cell:hover",
      ".month-cell.is-selected",
      ".month-cell.is-selected:hover",
      ".month-cell.is-outside",
    ]) {
      expect(bodyOf(selector)).toContain("var(--cell-surface");
    }
  });

  it("浅色与深色都定义了底色浓度与背景遮罩（§15 / §26 两套主题验收）", () => {
    const darkFrom = CSS.indexOf(':root[data-theme="dark"]');
    expect(darkFrom).toBeGreaterThan(0);
    const light = CSS.slice(0, darkFrom);
    const dark = CSS.slice(darkFrom);

    for (const token of [
      "--cell-tint-mix:",
      "--cell-backdrop-scrim-from:",
      "--cell-backdrop-scrim-to:",
    ]) {
      expect(light).toContain(token);
      expect(dark).toContain(token);
    }
    // §15.2 的休假不是「深一点的灰」：深色主题的底色底板要比浅色主题暗得多，
    // 否则语义色会被混成灰褐色（这就是两套主题各给一份底板的理由）。
    const lightBase = luminanceOf(colorOf(light, "--cell-tint-base:"));
    const darkBase = luminanceOf(colorOf(dark, "--cell-tint-base:"));
    expect(darkBase).toBeLessThan(lightBase);
    expect(darkBase).toBeLessThan(0.05);
    // 深色主题的照片要压暗，避免在深色界面里出现高亮白块（§15.3）。
    expect(dark).toContain("brightness(");
  });

  it("联赛背景图不再自己叠一层透明度：外层给的透明度就是最终值（§10.1）", () => {
    expect(bodyOf(".match-cell-bg")).toContain("opacity");
    expect(bodyOf(".match-cell-bg-image")).not.toContain("opacity");
  });
});

/** 取一个颜色 token 的取值；写成 var(--other) 时在给定范围内继续解析一层。 */
function colorOf(source: string, token: string): string {
  const pattern = new RegExp(
    `${token}\\s*(#[0-9a-fA-F]{6}|var\\(--[a-z-]+\\))`,
  );
  const match = pattern.exec(source);
  expect(match, `缺少 token：${token}`).not.toBeNull();
  const value = (match as RegExpExecArray)[1];
  return value.startsWith("var(")
    ? colorOf(source, `${value.slice(6, -1)}:`)
    : value;
}

/** 相对亮度（sRGB → 线性，ITU-R BT.709 系数），只用于比较两个色值谁更暗。 */
function luminanceOf(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
