/**
 * 注册表公共校验：Matcher 与 MetadataResolver 两个注册体系共用
 * 同一条“装配期拒绝重复 id”规则，避免两份实现漂移。
 */

export function assertUniqueIds<T extends { id: string }>(
  items: readonly T[],
  kind: string,
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`${kind} id 重复注册：${item.id}`);
    }
    seen.add(item.id);
  }
}
