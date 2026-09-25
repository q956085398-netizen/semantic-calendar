import { afterEach, describe, expect, it } from "vitest";
import { isTauriIpcUnavailable } from "./tauri-ipc";

/**
 * 「没有桌面壳」的判据（SC-003 / SC-002，app-spec §13）。
 *
 * 这条判据决定用户看到的是「浏览器预览模式」还是「本地数据层不可用
 * （<原因>）」。误判成预览会把真实故障藏起来，漏判会把内部报错原文
 * 丢到状态行上——两个方向都要有回归保护。
 */

/** @tauri-apps/api v2 的 invoke 在浏览器里抛出的原文（实测，2026-09-25）。 */
const MISSING_INVOKE = new TypeError(
  "Cannot read properties of undefined (reading 'invoke')",
);

/** 模拟桌面壳：Tauri v2 在页面脚本之前注入这个运行时镜像。 */
function defineTauriShell(): void {
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
}

afterEach(() => {
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("isTauriIpcUnavailable", () => {
  it("Chromium / WebView2：invoke 读到 undefined 的 TypeError 算没有桌面壳", () => {
    // 文案里不含符号名，因此只认 __TAURI_INTERNALS__ 的写法会漏掉真实浏览器。
    expect(isTauriIpcUnavailable(MISSING_INVOKE)).toBe(true);
  });

  it("WebKit / Firefox 的措辞同样算没有桌面壳", () => {
    expect(
      isTauriIpcUnavailable(
        new ReferenceError("window.__TAURI_INTERNALS__ is undefined"),
      ),
    ).toBe(true);
    expect(
      isTauriIpcUnavailable(
        "TypeError: undefined is not an object (evaluating 'window.__TAURI_INTERNALS__.invoke')",
      ),
    ).toBe(true);
  });

  it("桌面壳在时同样是 TypeError 的故障不算预览（环境事实优先于文案）", () => {
    // 只看文案会把「桌面壳在、这次失败恰好提到 invoke」也读成预览，
    // 于是真实故障被伪装成降级——§13 要求两者分开说。
    defineTauriShell();
    expect(isTauriIpcUnavailable(MISSING_INVOKE)).toBe(false);
  });

  it("快照读不出来的真实故障不算预览模式", () => {
    expect(
      isTauriIpcUnavailable(
        new Error("EACCES: permission denied, open 'calendar-store.json'"),
      ),
    ).toBe(false);
    expect(
      isTauriIpcUnavailable(new SyntaxError("Unexpected token } in JSON")),
    ).toBe(false);
    expect(
      isTauriIpcUnavailable(
        new Error("快照版本 7 比当前版本 1 更新，拒绝读取"),
      ),
    ).toBe(false);
  });

  it("只是提到 invoke 的其它 TypeError 不算（不把故障读成预览）", () => {
    expect(
      isTauriIpcUnavailable(new TypeError("callback.invoke is not a function")),
    ).toBe(false);
    defineTauriShell();
    expect(
      isTauriIpcUnavailable(new TypeError("callback.invoke is not a function")),
    ).toBe(false);
  });
});
