/** 距离下一个本地零点的毫秒数，供日期标记与每日调度共用。 */
export function nextLocalMidnightDelay(nowMs: number): number {
  const now = new Date(nowMs);
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.max(0, midnight.getTime() - nowMs);
}
