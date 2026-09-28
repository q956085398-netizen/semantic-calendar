import type { FixtureTeamDisplay } from "../../semantic/metadata-resolver";

const PREFIX = "unknown-team:";
/** Stable, filesystem-safe name for a user supplied image. */
export function customAssetSlug(name: string): string {
  const readable = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  let hash = 2166136261;
  for (const char of name.normalize("NFKC").toLowerCase()) {
    hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  }
  return `custom-${readable || "team"}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
export function unknownTeamId(name: string): string {
  return PREFIX + encodeURIComponent(name);
}
export function unknownTeamDisplay(id: string): FixtureTeamDisplay | undefined {
  if (!id.startsWith(PREFIX)) return undefined;
  let name: string;
  try {
    name = decodeURIComponent(id.slice(PREFIX.length));
  } catch {
    return undefined;
  }
  if (name.length === 0 || name.length > 80) return undefined;
  return {
    id,
    nameZh: name,
    nameEn: name,
    code: "?",
    crestRef: `crest.team.${customAssetSlug(name)}`,
    colors: { primary: "#74808B", secondary: "#FFFFFF" },
  };
}
