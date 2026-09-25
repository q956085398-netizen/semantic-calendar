/**
 * Tauri IPC 可用性判据（SC-003 / SC-002 共用）。
 *
 * 浏览器预览环境里 `invoke` 在读取 `window.__TAURI_INTERNALS__` 时抛错；
 * 只有这个形状的错误才代表“没有桌面壳”，其余错误都是真实故障——需要让
 * 用户看到，不能被当成预览模式掩盖（app-spec §13）。
 *
 * 判据是「环境里确实没有桌面壳」+「失败形状符合缺失 IPC」两条同时成立：
 * 前者是能力事实（`window.__TAURI_INTERNALS__` 由桌面壳在页面脚本之前注入，
 * 浏览器里没有），后者是错误文案的形状。只看文案会把「桌面壳在、这次失败
 * 恰好提到 invoke」也读成预览；只看环境又会把真实故障（快照打不开、权限、
 * 迁移链缺失）一起算进去——那正是 §13 要求分开说的两种状态。
 */
export function isTauriIpcUnavailable(error: unknown): boolean {
  if (
    typeof window !== "undefined" &&
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
      undefined
  ) {
    // 桌面壳在：任何失败都是真实故障，交给“本地数据层不可用（<原因>）”。
    return false;
  }
  const text = String(error);
  // WebKit / Firefox 的措辞里带符号名（"window.__TAURI_INTERNALS__ is
  // undefined"）；Chromium (WebView2 / 浏览器) 只说缺失的属性
  // （"Cannot read properties of undefined (reading 'invoke')"），
  // 因此第二种形状也要认——否则真实浏览器里的预览模式会被误报成
  // “本地数据层不可用”，并把内部报错原文显示给用户。
  return (
    /__TAURI_INTERNALS__/i.test(text) || /reading ['"]invoke['"]/i.test(text)
  );
}
