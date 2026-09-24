/**
 * 标题规范化（SC-008 / app-spec §7.3 Unicode + 标题常见格式）。
 *
 * 只做确定性清洗，供 Matcher 与去重比较使用；不包含任何业务关键词判断
 * （语义识别属 SC-009 Matcher Engine）。
 */

/** 零宽与 BOM 等不可见字符：NFKC 不会移除，直接剔除以防伪装匹配。 */
const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF\u2060]/g;

export function normalizeEventTitle(title: string): string {
  return title
    .normalize("NFKC")
    .replace(INVISIBLE_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 标题比较键：规范化后再压小写，作为“同一个写法”的判定口径。
 *
 * 词表（FootballCatalog 的别名索引）与 Matcher（SC-015）都用它，
 * 避免“什么算同一个写法”出现两套规则而悄悄漂移。
 */
export function titleKey(title: string): string {
  return normalizeEventTitle(title).toLowerCase();
}
