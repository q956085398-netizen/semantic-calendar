import type { EnrichedEvent } from "../data/model";
import { displayMetadataOf } from "../semantic/metadata-resolver";

export const FOLLOWED_ONLY_SETTING_KEY = "football.followedOnly";

export function readFollowedOnly(
  raw: unknown,
  hasFollowedTeams: boolean,
): boolean {
  return typeof raw === "boolean" ? raw : hasFollowedTeams;
}

/** Keep personal events; show a fixture only when either side is followed. */
export function filterFixturesByFollowedTeams(
  events: EnrichedEvent[],
  followedIds: readonly string[],
  followedOnly: boolean,
): EnrichedEvent[] {
  if (!followedOnly) return events;
  const followed = new Set(followedIds);
  return events.filter((event) => {
    if (event.semantic?.type !== "sport.fixture") return true;
    const teams = displayMetadataOf(event)?.fixture?.teams;
    return teams?.some((team) => followed.has(team.id)) ?? false;
  });
}
