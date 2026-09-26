import { invoke } from "@tauri-apps/api/core";
import {
  httpAbortError,
  type HttpGetRequest,
  type HttpGetResponse,
  type HttpIO,
} from "./http-io";

let requestSequence = 0;

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
    async get(
      request: HttpGetRequest,
      signal?: AbortSignal,
    ): Promise<HttpGetResponse> {
      if (signal?.aborted) throw httpAbortError();
      const requestId = `webcal-${++requestSequence}`;
      await invoke("webcal_request_begin", { requestId });

      const cancel = () => {
        void invoke("webcal_request_cancel", { requestId }).catch(() => {});
      };
      const onAbort = () => cancel();
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        cancel();
        signal.removeEventListener("abort", onAbort);
        throw httpAbortError();
      }

      try {
        const response = await invoke<{
          status: number;
          notModified: boolean;
          body?: string | null;
          etag?: string | null;
          lastModified?: string | null;
        }>("webcal_fetch", {
          requestId,
          url: request.url,
          etag: request.etag ?? null,
          lastModified: request.lastModified ?? null,
        });
        if (signal?.aborted) throw httpAbortError();
        return {
          status: response.status,
          notModified: response.notModified,
          body: response.body ?? undefined,
          etag: response.etag ?? undefined,
          lastModified: response.lastModified ?? undefined,
        };
      } catch (error) {
        if (signal?.aborted) throw httpAbortError();
        throw error;
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
