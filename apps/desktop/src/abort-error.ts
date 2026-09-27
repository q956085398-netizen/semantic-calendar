/** 创建标准 AbortError，供异步边界一致地区分主动取消与操作失败。 */
export function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
