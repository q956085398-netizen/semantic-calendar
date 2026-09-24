import { describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) =>
    invokeMock(command, args),
}));

import {
  createTauriNotificationBridge,
  createUnsupportedNotificationBridge,
  describeNotificationFailure,
  isPermissionDeniedFailure,
  normalizeNotificationPermission,
} from "./notification-bridge";

/**
 * SC-017 / NOTIFY-001、app-spec §13：通知端口。
 * 端口只做两件事——把权限状态收窄成已知取值，把失败原因翻译成可读文案。
 */

describe("通知端口（NOTIFY-001 / app-spec §13）", () => {
  it("权限取值收窄：未知按需要询问处理", () => {
    expect(normalizeNotificationPermission("granted")).toBe("granted");
    expect(normalizeNotificationPermission("denied")).toBe("denied");
    expect(normalizeNotificationPermission("prompt")).toBe("prompt");
    expect(normalizeNotificationPermission("granted!")).toBe("prompt");
    expect(normalizeNotificationPermission(undefined)).toBe("prompt");
  });

  it("桌面实现把权限状态与发送交给 Rust 命令", async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) =>
      command === "notification_status" ||
      command === "notification_request_permission"
        ? { permission: "granted" }
        : undefined,
    );
    const bridge = createTauriNotificationBridge();

    await expect(bridge.status()).resolves.toBe("granted");
    await expect(bridge.requestPermission()).resolves.toBe("granted");
    await bridge.send({ title: "标题", body: "正文" });

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "notification_status",
      "notification_request_permission",
      "notification_send",
    ]);
    expect(invokeMock).toHaveBeenCalledWith("notification_send", {
      title: "标题",
      body: "正文",
    });
  });

  it("桌面实现的发送失败会抛出，由调用方转成可解释状态", async () => {
    invokeMock.mockReset();
    invokeMock.mockRejectedValue({ kind: "send-failed", message: "系统拒绝" });
    const bridge = createTauriNotificationBridge();

    await expect(bridge.send({ title: "a", body: "b" })).rejects.toEqual({
      kind: "send-failed",
      message: "系统拒绝",
    });
  });

  it("预览模式：状态为 unsupported，发送不假装成功", async () => {
    const bridge = createUnsupportedNotificationBridge();

    expect(await bridge.status()).toBe("unsupported");
    expect(await bridge.requestPermission()).toBe("unsupported");
    await expect(bridge.send({ title: "a", body: "b" })).rejects.toThrow(
      /需要桌面环境/,
    );
  });

  it("失败原因映射成可解释文案", () => {
    expect(
      isPermissionDeniedFailure({ kind: "permission-denied", message: "x" }),
    ).toBe(true);
    expect(
      isPermissionDeniedFailure({ kind: "send-failed", message: "x" }),
    ).toBe(false);
    expect(isPermissionDeniedFailure(new Error("boom"))).toBe(false);

    expect(
      describeNotificationFailure({ kind: "permission-denied", message: "x" }),
    ).toContain("系统通知权限被拒绝");
    expect(
      describeNotificationFailure({ kind: "send-failed", message: "系统拒绝" }),
    ).toBe("系统通知未能弹出：系统拒绝");
    expect(describeNotificationFailure(new Error("boom"))).toBe(
      "通知发送失败：boom",
    );
  });
});
