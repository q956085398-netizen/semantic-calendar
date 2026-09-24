import { invoke } from "@tauri-apps/api/core";

/**
 * 本地通知端口（SC-017 / NOTIFY-001、app-spec §13）。
 *
 * 与 `data/net/http-io.ts`、`shell/shell-bridge.ts` 同一角色：把“操作系统
 * 能力”收窄成界面需要的一小段接口。真正的实现在 Rust（src-tauri/src/notify.rs），
 * webview 不直接接触插件 API；测试与浏览器预览用假实现替换。
 */

/** 权限状态；unsupported 表示当前环境没有桌面壳（浏览器预览）。 */
export type NotificationPermissionState =
  "granted" | "denied" | "prompt" | "unsupported";

export interface NotificationBridge {
  /** 当前权限状态；只读，不触发系统询问。 */
  status(): Promise<NotificationPermissionState>;
  /** 请求权限（桌面端无副作用，移动端会弹系统对话框）。 */
  requestPermission(): Promise<NotificationPermissionState>;
  /** 发送一条通知；失败抛出，由调用方转成可解释状态。 */
  send(payload: { title: string; body: string }): Promise<void>;
}

export function createTauriNotificationBridge(): NotificationBridge {
  return {
    async status() {
      const answer = await invoke<{ permission?: unknown }>(
        "notification_status",
      );
      return normalizeNotificationPermission(answer?.permission);
    },
    async requestPermission() {
      const answer = await invoke<{ permission?: unknown }>(
        "notification_request_permission",
      );
      return normalizeNotificationPermission(answer?.permission);
    },
    async send(payload) {
      // 命令参数名与 Rust 侧一致（snake_case 由 Tauri 转换）。
      await invoke("notification_send", {
        title: payload.title,
        body: payload.body,
      });
    },
  };
}

/** 没有桌面壳的环境：状态恒为 unsupported，发送不假装成功。 */
export function createUnsupportedNotificationBridge(): NotificationBridge {
  const message = "浏览器预览模式：系统通知需要桌面环境";
  return {
    status: async () => "unsupported",
    requestPermission: async () => "unsupported",
    send: async () => {
      throw new Error(message);
    },
  };
}

/** 未知取值按“需要询问”处理：不猜成已授权（P-03）。 */
export function normalizeNotificationPermission(
  value: unknown,
): NotificationPermissionState {
  return value === "granted" || value === "denied" || value === "prompt"
    ? value
    : "prompt";
}

/** 发送失败是否为“没有权限”（Rust 侧 kind = permission-denied）。 */
export function isPermissionDeniedFailure(error: unknown): boolean {
  return failureKind(error) === "permission-denied";
}

/**
 * 发送失败 → 用户可读文案（§13）。
 * 只陈述系统给的事实与下一步，不猜测原因；未知形状按通用失败处理。
 */
export function describeNotificationFailure(error: unknown): string {
  const message = failureMessage(error);
  switch (failureKind(error)) {
    case "permission-denied":
      return "系统通知权限被拒绝：提醒未能弹出，日历其他功能不受影响";
    case "send-failed":
      return `系统通知未能弹出${message ? `：${message}` : ""}`;
    default:
      return `通知发送失败${message ? `：${message}` : ""}`;
  }
}

function failureKind(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "kind" in error) {
    const kind = (error as { kind?: unknown }).kind;
    return typeof kind === "string" ? kind : undefined;
  }
  return undefined;
}

function failureMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return error instanceof Error ? error.message : "";
}
