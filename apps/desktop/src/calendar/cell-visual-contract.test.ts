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
    const cell = bodyOf(".month-cell");

    expect(cell).toContain("overflow: hidden");
    // 裁切与包含块是一件事的两半（§7.2「允许被格子边缘裁切」+「不溢出日期格」）：
    // 背景层是绝对定位的，先得真的落在格子里，格子的 overflow 才管得到它们
    // （裁切只对格子内部的后代生效）。让格子成为包含块的有两条：这里的
    // position: relative 是显式的那条，.month-cell 的 container-type
    // （SC-023 为对阵块收缩引入）另有布局包含的效果；断言盯的是显式那条——
    // 它不是冗余写法，去掉它就只剩一个与对阵块需求绑在一起的副作用。
    expect(cell).toContain("position: relative");
    for (const selector of [
      ".cell-glyph",
      ".match-cell-bg",
      ".cell-backdrop",
    ]) {
      expect(bodyOf(selector)).toContain("position: absolute");
    }
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

  it("大字与狮标是有意越界的：越界由格子裁掉，才读成「不完整」的字与放大的 Logo（§7.2 / §8.2 / §10.1）", () => {
    // §7.2 要的是「放大的、半透明的、**不完整**的」字：不完整来自负偏移让它越过
    // 格子下边缘，再由格子的裁切收住。把偏移改成正值，字就完整了、也不再被裁——
    // 因此这里断言的是「越界是有意的」，与上一条的裁切合起来才是完整的规则。
    expect(pxValueOf(bodyOf(".cell-glyph"), "bottom")).toBeLessThan(0);
    // 狮标同理：§10.1 说「背景 Logo 可很大」，§26 第 11 项验收记录的正是
    // 「狮标水印按 right/bottom 负偏移铺出格边界后被裁」这个形态。
    const league = bodyOf(".match-cell-bg");
    expect(pxValueOf(league, "right")).toBeLessThan(0);
    expect(pxValueOf(league, "bottom")).toBeLessThan(0);
    // §10.1「背景 Logo 可很大」+ §22：容器尺寸写死、比例固定，素材多大都不改变
    // 格子布局，也不因为素材长宽比不同而变形。
    const image = bodyOf(".match-cell-bg-image");
    expect(pxValueOf(image, "width")).toBeGreaterThan(0);
    expect(pxValueOf(image, "height")).toBe(pxValueOf(image, "width"));
    expect(image).toContain("object-fit: contain");
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
    const { light, dark } = themeScopes();

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
    const lightBase = luminanceOf(colorOf(light, "--cell-tint-base"));
    const darkBase = luminanceOf(colorOf(dark, "--cell-tint-base"));
    expect(darkBase).toBeLessThan(lightBase);
    expect(darkBase).toBeLessThan(0.05);
    // 深色主题的照片要压暗，避免在深色界面里出现高亮白块（§15.3）。
    expect(dark).toContain("brightness(");
  });

  it("联赛背景图不再自己叠一层透明度：外层给的透明度就是最终值（§10.1）", () => {
    expect(bodyOf(".match-cell-bg")).toContain("opacity");
    expect(bodyOf(".match-cell-bg-image")).not.toContain("opacity");
  });

  it("语义色按类别分色、两套主题都不混：休 / 补 / 节气 / 比赛各占一支色系（§8.1 / §15.2 / §20）", () => {
    // §20 的书面语义（放假 = 淡暖红 / 淡珊瑚，补班 = 淡蓝 / 雾蓝，节气 = 低饱和绿 / 青 / 蓝，
    // 比赛 = 联赛紫 / 球队色，选中 = 珊瑚描边）到这里才是可执行的：色值可以调，
    // 但「哪一类长什么样」不能悄悄对调——把补班的蓝换成假期的红，界面语义就反了。
    // 断言取色相区间而不是具体色值：调色板换色不需要改测试，换了类别才需要。
    // 口径来自 README 与 index.css 自己的话「语义色体系由 SC-013 定稿」；
    // §20 的「普通日期」一行不在这一条里——它由上下两条（主题底板与浓度）覆盖。
    const bands: Record<string, [number, number]> = {
      // [起点, 终点]，起点大于终点表示跨过 0°。
      // 暖红 / 珊瑚到 25° 为止：再往上就进了节日那支琥珀（#b9803c 约 33°），
      // 假期穿上节日的颜色是这一条最该拦住的错。
      "--semantic-holiday": [340, 25],
      "--semantic-makeup-workday": [190, 250],
      "--semantic-solar-term": [90, 220],
      "--semantic-sport": [235, 290],
    };

    for (const theme of ["light", "dark"] as const) {
      const hues: number[] = [];
      for (const [token, band] of Object.entries(bands)) {
        const value = tokenIn(theme, token);
        // 先要求「这是一支有色彩的色」：灰色谈色相没有意义（灰的色相会被算成 0°，
        // 正好落进暖红那一档）。下限压得低是有意的——§20 要的正是低饱和（节气那支
        // 「低饱和绿」的饱和度只有 0.29），这一条只负责排掉「几乎没色」。
        expect(
          saturationOf(value),
          `${theme} 主题的 ${token} 应是一支有色相的类别色，而不是灰（${value}）`,
        ).toBeGreaterThan(0.08);

        const hue = hueOf(value);
        expect(
          inBand(hue, band),
          `${theme} 主题的 ${token} 应落在 §20 的色系里（实际色相 ${hue.toFixed(0)}°）`,
        ).toBe(true);
        hues.push(hue);
      }
      // 四类不仅要在各自的色系里，彼此还得一眼分得开：§20 的区间本身有重叠
      // （节气可以是蓝、比赛可以是深蓝），文字上的相邻不等于画面上的相邻。
      for (let i = 0; i < hues.length; i += 1) {
        for (let j = i + 1; j < hues.length; j += 1) {
          expect(
            hueDistance(hues[i], hues[j]),
            `${theme} 主题的 ${Object.keys(bands)[i]} 与 ${Object.keys(bands)[j]} 应分得开`,
          ).toBeGreaterThanOrEqual(30);
        }
      }
      // §8.1「补班与休假采用同一视觉语言，但颜色区分」：这一对要离得最开。
      expect(
        hueDistance(
          hueOf(tokenIn(theme, "--semantic-holiday")),
          hueOf(tokenIn(theme, "--semantic-makeup-workday")),
        ),
      ).toBeGreaterThanOrEqual(120);
      // §17 / §20：选中是珊瑚细描边，与假期底色同属暖红系（同一支 --accent）。
      const accent = tokenIn(theme, "--accent");
      expect(saturationOf(accent)).toBeGreaterThan(0.08);
      expect(inBand(hueOf(accent), [340, 25])).toBe(true);
    }
  });
});

/**
 * 主题切分：`:root[data-theme="dark"]` 之前是浅色块、之后是深色块
 * （同一个选择器在后面还会再出现，用来覆盖个别规则；token 只定义在这两处，
 * 所以按第一次出现切分即可）。
 */
function themeScopes(): { light: string; dark: string } {
  const darkFrom = CSS.indexOf(':root[data-theme="dark"]');
  expect(darkFrom).toBeGreaterThan(0);
  return { light: CSS.slice(0, darkFrom), dark: CSS.slice(darkFrom) };
}

/**
 * 在给定的 CSS 片段里按顺序找一个 token 的取值（写成 var(--other) 时在
 * 同一批片段里继续解析）；都找不到返回 undefined。解析规则只有这一处，
 * 「在哪个范围里找」由调用方决定：分段找（colorOf）还是按主题找（tokenIn）。
 */
function lookupToken(
  name: string,
  scopes: readonly string[],
): string | undefined {
  for (const scope of scopes) {
    const match = new RegExp(
      `${name}:\\s*(#[0-9a-fA-F]{6}|var\\(--[a-z-]+\\))`,
    ).exec(scope);
    if (!match) continue;
    const value = match[1];
    return value.startsWith("var(")
      ? lookupToken(value.slice(6, -1), scopes)
      : value;
  }
  return undefined;
}

/** 取一个颜色 token 的取值（token 名不带冒号）；缺失即断言失败。 */
function colorOf(source: string, token: string): string {
  const value = lookupToken(token, [source]);
  expect(value, `缺少 token：${token}`).toBeDefined();
  return value as string;
}

/**
 * 按主题取一个 token 的**最终**色值：深色块里没有重定义的 token 继承 :root，
 * 与浏览器里的层叠同一顺序（`--semantic-holiday` 只在浅色块里定义，
 * 深色主题用的是同一支色）。取最终值而不是「就近取一处」，是为了让断言
 * 认的是画面上的颜色，而不是 token 定义在哪一行。
 */
function tokenIn(theme: "light" | "dark", name: string): string {
  const { light, dark } = themeScopes();
  const value = lookupToken(name, theme === "dark" ? [dark, light] : [light]);
  expect(value, `index.css 缺少 token：${name}`).toBeDefined();
  return value as string;
}

/**
 * 规则体里某个属性的像素值（如 `bottom: -13px` → -13）。
 * 属性名前不允许再跟 `-` 或字母：否则 `right` 会命中 `padding-right`、
 * `width` 会命中 `min-width`（同一段规则体里两种都可能出现）。
 */
function pxValueOf(body: string, property: string): number {
  const match = new RegExp(`(?<![\\w-])${property}:\\s*(-?[\\d.]+)px`).exec(
    body,
  );
  expect(match, `规则体里缺少 ${property}: …px`).not.toBeNull();
  return Number((match as RegExpExecArray)[1]);
}

/**
 * 色相（0–360° sRGB）：只用来判断「这是红 / 蓝 / 绿 / 紫」，不判断具体色值。
 * 灰没有色相可言，这里返回 0；调用方先用 saturationOf 排掉灰。
 */
function hueOf(hex: string): number {
  const [r, g, b] = channelsOf(hex);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const sector =
    max === r
      ? ((g - b) / delta) % 6
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return (((sector * 60) % 360) + 360) % 360;
}

/** 饱和度（HSV 口径：最强通道与最弱通道之差 ÷ 最强通道）：0 是灰，1 是纯色。 */
function saturationOf(hex: string): number {
  const channels = channelsOf(hex);
  const max = Math.max(...channels);
  return max === 0 ? 0 : (max - Math.min(...channels)) / max;
}

/** 色相是否落在 [起点, 终点] 区间里；起点大于终点表示这个区间跨过 0°。 */
function inBand(hue: number, [from, to]: [number, number]): boolean {
  return from <= to ? hue >= from && hue <= to : hue >= from || hue <= to;
}

/** 两个色相之间的最短距离（0–180°）。 */
function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b);
  return Math.min(distance, 360 - distance);
}

/** 十六进制色值的三个通道（0–1）。 */
function channelsOf(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map(
    (offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  return [r, g, b];
}

/** 相对亮度（sRGB → 线性，ITU-R BT.709 系数），只用于比较两个色值谁更暗。 */
function luminanceOf(hex: string): number {
  const channels = channelsOf(hex).map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
