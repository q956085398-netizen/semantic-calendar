import type { FixtureTeamDisplay } from "../../semantic/metadata-resolver";

const PREFIX = "unknown-team:";
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
    crestRef: "crest.team.unknown",
    colors: { primary: "#74808B", secondary: "#FFFFFF" },
  };
}
