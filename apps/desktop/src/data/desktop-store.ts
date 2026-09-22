import { CalendarStore, type StoreOpenResult } from "./store/calendar-store";
import { createTauriFileIO } from "./store/tauri-file-io";

/** 桌面端唯一的数据快照文件（位于 app data dir 的 store 子目录）。 */
export const STORE_FILE_NAME = "calendar-store.json";

/**
 * 打开桌面端本地数据层。
 *
 * 返回 null 仅表示当前环境没有 Tauri IPC（浏览器预览 / 测试），
 * 调用方应降级提示而不是让应用崩溃（app-spec §13）。
 * 其它失败（磁盘错误、迁移链缺失）会重新抛出，由调用方按
 * “初始化失败”处理，避免伪装成预览模式掩盖真实问题。
 */
export async function openDesktopCalendarStore(): Promise<StoreOpenResult | null> {
  try {
    return await CalendarStore.open(createTauriFileIO(), STORE_FILE_NAME);
  } catch (error) {
    if (isIpcUnavailable(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * 无 Tauri 运行时的浏览器环境里，invoke 会在访问
 * window.__TAURI_INTERNALS__ 时抛错；据此区分“预览模式”与真实故障。
 */
function isIpcUnavailable(error: unknown): boolean {
  return /__TAURI_INTERNALS__/i.test(String(error));
}
