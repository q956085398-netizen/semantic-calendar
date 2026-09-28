import type { EnrichedEvent } from "../data/model";
import { isBuiltinSourceEnabled, type BuiltinSourceId } from "../settings/builtin-sources";

/** Imported fixtures are user sources. Built-in switches only gate the user's
 * whole calendar; holiday and solar-term switches gate their own day payloads.
 */
export function gateEventsForBuiltinSources(
  events: EnrichedEvent[],
  hidden: readonly BuiltinSourceId[],
): EnrichedEvent[] {
  return isBuiltinSourceEnabled(hidden, "mine") ? events : [];
}
