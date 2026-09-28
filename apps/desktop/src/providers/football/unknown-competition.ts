import type { FixtureCompetitionDisplay } from "../../semantic/metadata-resolver";
import { customAssetSlug } from "./unknown-team";

const PREFIX = "unknown-competition:";

export function unknownCompetitionId(name: string): string {
  return PREFIX + encodeURIComponent(name);
}

export function unknownCompetitionDisplay(
  id: string,
): FixtureCompetitionDisplay | undefined {
  if (!id.startsWith(PREFIX)) return undefined;
  let name: string;
  try {
    name = decodeURIComponent(id.slice(PREFIX.length));
  } catch {
    return undefined;
  }
  if (!name || name.length > 80) return undefined;
  return {
    id,
    label: name,
    nameZh: name,
    nameEn: name,
    logoRef: `logo.competition.${customAssetSlug(name)}`,
    colors: { primary: "#536578", secondary: "#FFFFFF" },
  };
}
