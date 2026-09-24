import { invoke } from "@tauri-apps/api/core";
import type { HttpGetRequest, HttpGetResponse, HttpIO } from "./http-io";

/**
 * 桌面壳 HttpIO：走 Rust 命令抓取订阅内容。
 *
 * 放在 Rust 侧而不是 webview fetch 的原因：
 * - webview 里 fetch 远程地址受同源策略限制，绝大多数 ICS 服务端
 *   不返回 CORS 头，订阅会直接失败；
 * - 敏感 token 不进入 webview 的网络栈与开发者工具。
 */
export function createTauriHttpIO(): HttpIO {
  return {
    async get(request: HttpGetRequest): Promise<HttpGetResponse> {
      const response = await invoke<{
        status: number;
        notModified: boolean;
        body?: string | null;
        etag?: string | null;
        lastModified?: string | null;
      }>("webcal_fetch", {
        url: request.url,
        etag: request.etag ?? null,
        lastModified: request.lastModified ?? null,
      });
      return {
        status: response.status,
        notModified: response.notModified,
        body: response.body ?? undefined,
        etag: response.etag ?? undefined,
        lastModified: response.lastModified ?? undefined,
      };
    },
  };
}
