import { describe, expect, it } from "vitest";
import type { EnrichedEvent } from "../data/model";
import { filterFixturesByFollowedTeams } from "./fixture-visibility";

function fixture(uid: string, home: string, away: string): EnrichedEvent {
  return {
    uid,
    sourceId: "schedule",
    title: `${home} vs ${away}`,
    start: "2026-09-27T00:00:00",
    allDay: false,
    normalizedTitle: `${home} vs ${away}`,
    semantic: { type: "sport.fixture" },
    metadata: {
      fixture: {
        competition: {
          id: "nations-league",
          label: "欧国联",
          nameZh: "欧洲国家联赛",
          nameEn: "UEFA Nations League",
          colors: { primary: "#153985", secondary: "#FFFFFF" },
        },
        teams: [home, away].map((id) => ({
          id,
          nameZh: id,
          nameEn: id,
          code: id.slice(0, 3),
          colors: { primary: "#123456", secondary: "#FFFFFF" },
        })),
      },
    },
  };
}

describe("只看关注球队", () => {
  it("同日五场只保留两支已关注球队各自的比赛，普通日程仍显示", () => {
    const matches = [
      fixture("1", "england", "spain"),
      fixture("2", "china", "japan"),
      fixture("3", "france", "germany"),
      fixture("4", "italy", "portugal"),
      fixture("5", "brazil", "argentina"),
    ];
    const ordinary = {
      ...matches[0],
      uid: "meeting",
      semantic: undefined,
      metadata: undefined,
    };
    expect(
      filterFixturesByFollowedTeams(
        [...matches, ordinary],
        ["england", "china"],
        true,
      ).map((event) => event.uid),
    ).toEqual(["1", "2", "meeting"]);
    expect(filterFixturesByFollowedTeams(matches, [], false)).toBe(matches);
  });
});
