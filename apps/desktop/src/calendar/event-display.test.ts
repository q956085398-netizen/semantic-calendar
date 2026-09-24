import { describe, expect, it } from "vitest";
import type { EnrichedEvent } from "../data/model";
import { splitFixtureEvents } from "./event-display";

/**
 * 事件切分（SC-016）：月格与 Inspector 共用的判定缝。
 *
 * 只有“Resolver 给出了完整对阵载荷”的事件才进比赛通道；
 * 识别出 sport.fixture 但载荷缺失 / 畸形的事件必须留在普通通道，
 * 否则月格会渲染出一张缺一侧的半张比赛卡（SPORT-004）。
 */

function event(overrides: Partial<EnrichedEvent> = {}): EnrichedEvent {
  return {
    uid: "event-1",
    sourceId: "src-1",
    title: "标题",
    normalizedTitle: "标题",
    start: "2026-10-01T10:00:00",
    allDay: false,
    ...overrides,
  };
}

const FIXTURE_METADATA = {
  accent: "var(--semantic-sport)",
  label: "体育赛事",
  fixture: {
    competition: {
      id: "league",
      label: "联赛",
      nameZh: "联赛",
      nameEn: "League",
      colors: { primary: "#111111", secondary: "#FFFFFF" },
    },
    teams: [
      {
        id: "team-a",
        nameZh: "甲队",
        nameEn: "Team A",
        code: "TMA",
        colors: { primary: "#111111", secondary: "#FFFFFF" },
      },
      {
        id: "team-b",
        nameZh: "乙队",
        nameEn: "Team B",
        code: "TMB",
        colors: { primary: "#222222", secondary: "#FFFFFF" },
      },
    ],
  },
};

describe("比赛事件切分（SC-016）", () => {
  it("有完整对阵载荷的事件进入比赛通道", () => {
    const match = event({
      semantic: { type: "sport.fixture", matcherId: "m" },
      metadata: FIXTURE_METADATA,
    });
    const plain = event({ uid: "event-2" });

    const { fixtures, ordinary } = splitFixtureEvents([match, plain]);
    expect(fixtures.map((entry) => entry.event.uid)).toEqual(["event-1"]);
    expect(fixtures[0].fixture.competition.label).toBe("联赛");
    expect(ordinary.map((entry) => entry.uid)).toEqual(["event-2"]);
  });

  it("载荷残缺（两侧凑不齐 / 缺联赛）的事件留在普通通道", () => {
    const oneTeam = event({
      semantic: { type: "sport.fixture", matcherId: "m" },
      metadata: {
        ...FIXTURE_METADATA,
        fixture: {
          ...FIXTURE_METADATA.fixture,
          teams: [FIXTURE_METADATA.fixture.teams[0]],
        },
      },
    });
    const noCompetition = event({
      uid: "event-3",
      semantic: { type: "sport.fixture", matcherId: "m" },
      metadata: { accent: "var(--semantic-sport)", label: "体育赛事" },
    });

    const { fixtures, ordinary } = splitFixtureEvents([oneTeam, noCompetition]);
    expect(fixtures).toEqual([]);
    expect(ordinary).toHaveLength(2);
  });

  it("元数据畸形（非对象 / 类型错误）不抛错，按普通事件处理", () => {
    const broken = event({
      semantic: { type: "sport.fixture", matcherId: "m" },
      metadata: { fixture: "坏载荷" },
    });
    const { fixtures, ordinary } = splitFixtureEvents([broken]);
    expect(fixtures).toEqual([]);
    expect(ordinary).toHaveLength(1);
  });

  it("保持原顺序：同一天多场比赛按事件顺序排列", () => {
    const first = event({
      uid: "match-1",
      semantic: { type: "sport.fixture", matcherId: "m" },
      metadata: FIXTURE_METADATA,
    });
    const second = event({
      uid: "match-2",
      semantic: { type: "sport.fixture", matcherId: "m" },
      metadata: FIXTURE_METADATA,
    });

    expect(
      splitFixtureEvents([first, second]).fixtures.map(
        (entry) => entry.event.uid,
      ),
    ).toEqual(["match-1", "match-2"]);
  });
});
