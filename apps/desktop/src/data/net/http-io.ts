/**
 * 网络访问端口（SC-007 / app-spec §12）。
 *
 * 只暴露“带条件校验值的 GET”这一种形状：订阅刷新的全部网络需求就是
 * 它，而把端口收窄可以让桌面壳实现（Rust 侧）与测试替身都保持简单。
 *
 * 约定：
 * - 超时由实现方保证（app-spec §12：网络任务必须有超时）；
 * - 非 2xx 不抛错，按状态码返回，由调用方决定如何降级（§13）；
 * - 实现方不得记录请求地址：URL 可能含服务端签发的敏感 token（§14）。
 */
export interface HttpGetRequest {
  url: string;
  /** 上次响应的 ETag，服务端可据此返回 304，避免重复下载。 */
  etag?: string;
  lastModified?: string;
}

export interface HttpGetResponse {
  status: number;
  /** 304：本地缓存仍然有效，body 为空。 */
  notModified: boolean;
  /** 响应正文；notModified 或非文本响应时为 undefined。 */
  body?: string;
  /** 本次响应的校验值，服务端未提供时缺省（调用方需清掉旧值）。 */
  etag?: string;
  lastModified?: string;
}

export interface HttpIO {
  get(request: HttpGetRequest): Promise<HttpGetResponse>;
}
