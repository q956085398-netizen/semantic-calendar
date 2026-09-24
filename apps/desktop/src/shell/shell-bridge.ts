import { invoke } from "@tauri-apps/api/core";
import { normalizeCloseBehavior, type CloseBehavior } from "./close-behavior";

/**
 * 桌面壳端口（SC-002）：把“窗口怎么活”的设置交给 Rust 侧执行。
 *
 * 与 `data/net/http-io.ts` 同一角色——端口收窄到当前真正需要的一条：
 * 推送关闭行为。窗口显示 / 隐藏本身由托盘、单实例与关闭事件在 Rust 内部
 * 调用，不经过 webview，因此不在这里开口子。
 *
 * 预览模式（无 Tauri IPC）由调用方按“IPC 不可用”处理：设置仍可在本次
 * 会话内切换，只是不持久化也不生效，与主题切换的降级口径一致。
 */
export interface ShellBridge {
  /**
   * 推送关闭行为，返回桌面壳的观察结果：实际生效的行为 + 托盘是否可用。
   * 托盘不可用时“隐藏到托盘”会退化为退出，此时两者会同时体现出来。
   * Rust 侧只接受已知取值，未知值会拒绝。
   */
  setCloseBehavior(behavior: CloseBehavior): Promise<ShellCloseBehaviorStatus>;
}

/** 桌面壳对一次关闭行为设置的回答（与 Rust `CloseBehaviorStatus` 对应）。 */
export interface ShellCloseBehaviorStatus {
  /** 实际生效的关闭行为；未知取值按默认口径收窄（P-03）。 */
  behavior: CloseBehavior;
  /** 托盘是否真的装上了；false 表示“隐藏到托盘”已降级为退出。 */
  trayAvailable: boolean;
}

export function createTauriShellBridge(): ShellBridge {
  return {
    async setCloseBehavior(behavior) {
      const status = await invoke<{
        behavior?: unknown;
        trayAvailable?: unknown;
      }>("shell_set_close_behavior", { behavior });
      return {
        behavior: normalizeCloseBehavior(status?.behavior),
        trayAvailable: status?.trayAvailable === true,
      };
    },
  };
}
