/**
 * 分片边界（SC-024 / app-spec §15）。
 *
 * 分片生成器的形状统一为「每 chunk 个元素 yield 一次，同步入口 = 一次排空」，
 * 判断放在循环**开头**而不是末尾，循环体里的 `continue` 才绕不过它；chunk 取
 * 非正数表示中间不让出（同步排空与「一条也不分片」的对照都是这个含义）。
 *
 * 每个模块各自持有粒度常量（解析 128 块 / 1024 行、标准化 128 条、落库 128 条、
 * 序列化 128 项）——每一处的每条代价不同，理由写在各自的常量旁边；这里只统一
 * 边界规则本身，避免四份实现各自漂移。
 */
export function isChunkBoundary(index: number, chunk: number): boolean {
  return chunk > 0 && index > 0 && index % chunk === 0;
}
