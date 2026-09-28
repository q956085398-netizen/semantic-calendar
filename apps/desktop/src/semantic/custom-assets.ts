import type { EnrichedEvent } from "../data/model";
import { displayMetadataOf } from "./metadata-resolver";

export function customAssetPath(ref: string): string | undefined {
  if (ref.startsWith("crest.team.")) return `teams/${ref.slice(11)}.png`;
  if (ref.startsWith("logo.competition."))
    return `competitions/${ref.slice(17)}.png`;
  if (ref.startsWith("bg.festival."))
    return `days/festival-${ref.slice(12)}.png`;
  if (ref.startsWith("bg.solar-term."))
    return `days/solar-term-${ref.slice(14)}.png`;
  if (ref.startsWith("bg.holiday.")) return `days/holiday-${ref.slice(11)}.png`;
  return undefined;
}

export function fixtureAssetRefsAll(
  events: readonly EnrichedEvent[],
): string[] {
  const refs = new Set<string>();
  for (const event of events) {
    const fixture = displayMetadataOf(event)?.fixture;
    if (!fixture) continue;
    for (const ref of [
      fixture.competition.logoRef,
      ...fixture.teams.map((team) => team.crestRef),
    ]) {
      if (ref) refs.add(ref);
    }
  }
  return [...refs].sort();
}
