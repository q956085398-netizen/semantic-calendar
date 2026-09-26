import { afterEach, describe, expect, it, vi } from "vitest";
import { createTauriShellBridge } from "./shell-bridge";
import { isTauriIpcUnavailable } from "../ipc/tauri-ipc";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
}));

afterEach(() => {
  invokeMock.mockReset();
});

describe("createTauriShellBridge", () => {
  it("推送关闭行为时调用 shell_set_close_behavior 命令", async () => {
    invokeMock.mockResolvedValue({
      behavior: "hide-to-tray",
      trayAvailable: true,
    });
    const bridge = createTauriShellBridge();

    await bridge.setCloseBehavior("hide-to-tray");
    await bridge.setCloseBehavior("quit");

    expect(invokeMock.mock.calls).toEqual([
      ["shell_set_close_behavior", { behavior: "hide-to-tray" }],
      ["shell_set_close_behavior", { behavior: "quit" }],
    ]);
  });

  it("透传桌面壳报告的实际行为与托盘可用性", async () => {
    invokeMock.mockResolvedValue({ behavior: "quit", trayAvailable: false });
    const bridge = createTauriShellBridge();

    // 请求“隐藏到托盘”，桌面壳因托盘不可用降级为退出。
    expect(await bridge.setCloseBehavior("hide-to-tray")).toEqual({
      behavior: "quit",
      trayAvailable: false,
    });
  });

  it("返回值缺字段时按保守口径收窄（不把缺失当成托盘可用）", async () => {
    invokeMock.mockResolvedValue(null);
    const bridge = createTauriShellBridge();

    expect(await bridge.setCloseBehavior("quit")).toEqual({
      behavior: "hide-to-tray",
      trayAvailable: false,
    });
  });

  it("Rust 侧拒绝未知取值时把错误抛给调用方（不静默吞掉）", async () => {
    invokeMock.mockRejectedValue(new Error("未知的关闭行为：exit"));
    const bridge = createTauriShellBridge();

    await expect(bridge.setCloseBehavior("quit")).rejects.toThrow(
      "未知的关闭行为",
    );
  });
});

describe("isTauriIpcUnavailable", () => {
  it("识别无 Tauri 运行时的 IPC 错误（浏览器预览模式）", () => {
    expect(
      isTauriIpcUnavailable(
        new Error("window.__TAURI_INTERNALS__ is undefined"),
      ),
    ).toBe(true);
  });

  it("真实故障不当作预览模式（需要让用户看到）", () => {
    expect(isTauriIpcUnavailable(new Error("未知的关闭行为：exit"))).toBe(
      false,
    );
    expect(isTauriIpcUnavailable(undefined)).toBe(false);
  });
});
