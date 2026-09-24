import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NARROW_LAYOUT_THRESHOLDS } from "./AppShell";

/**
 * 窗口最小尺寸（SC-002）与窄窗折叠阈值（CAL-004）是同一份契约：
 * 窗口缩到允许的最小宽度时，两侧面板都已自动收起，月历主体仍然完整，
 * 折叠栏以悬浮按钮形式提供临时展开（ui-design §23 的“最窄允许范围”）。
 *
 * 这条契约跨了 TypeScript 与 tauri.conf.json 两个文件，容易在调参时
 * 被破坏（例如把最小宽度调大却没有同步阈值），所以在这里锁住。
 */
function mainWindowConfig(): {
  minWidth?: number;
  minHeight?: number;
  label?: string;
} {
  // vitest 以 apps/desktop 为工作目录运行（npm workspace 脚本约定）。
  const configPath = resolve(process.cwd(), "src-tauri", "tauri.conf.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    app: {
      windows: Array<{ label?: string; minWidth?: number; minHeight?: number }>;
    };
  };
  const main = config.app.windows[0];
  expect(main.label).toBe("main");
  return main;
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
