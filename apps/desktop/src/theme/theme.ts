/**
 * 明暗主题（THEME-001/002/003）。
 *
 * 主题是纯展示状态：持久化走 CalendarStore 设置（键 app.theme），
 * 生效方式是给 <html> 写 data-theme，由 CSS 变量决定整套配色。
 */

export type Theme = "light" | "dark";

/** 持久化键，与快照 settings 命名空间一致。 */
export const THEME_SETTING_KEY = "app.theme";

/**
 * 预绘制缓存键：index.html 的内联脚本在首帧前读取它着色，
 * 避免深色用户每次启动先看到浅色闪屏。键名必须与该脚本保持一致。
 * 权威来源仍是本地快照 store；加载完成后 applyTheme 会覆盖此缓存。
 */
const THEME_PAINT_CACHE_KEY = "semantic-calendar.theme";

/** 快照 / 设置中的任意值 → 主题；非法值回退浅色。 */
export function normalizeTheme(value: unknown): Theme {
  return value === "dark" ? "dark" : "light";
}

export function toggleTheme(theme: Theme): Theme {
  return theme === "light" ? "dark" : "light";
}

/** 应用到文档根元素；测试环境同样可用（jsdom 支持 dataset）。 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_PAINT_CACHE_KEY, theme);
  } catch {
    // localStorage 不可用（隐私模式等）时只跳过预绘制缓存。
  }
}
