/**
 * Tauri IPC 可用性判据（SC-003 / SC-002 共用）。
 *
 * 浏览器预览环境里 `invoke` 会在访问 `window.__TAURI_INTERNALS__` 时抛错；
 * 只有这个形状的错误才代表“没有桌面壳”，其余错误都是真实故障——需要让
 * 用户看到，不能被当成预览模式掩盖（app-spec §13）。
 */
export function isTauriIpcUnavailable(error: unknown): boolean {
  return /__TAURI_INTERNALS__/i.test(String(error));
}
