import { describe, expect, it } from "vitest";
import { COMPETITIONS, SEASONS, type SeasonRoster } from "./competitions";
import {
  createFootballCatalog,
  footballCatalog,
  type FootballCatalogData,
} from "./football-catalog";
import { TEAMS, type TeamMetadata } from "./teams";

/** 构造最小数据集的辅助：默认两支球队 + 一个联赛 / 赛季。 */
function dataWith(
  overrides: Partial<FootballCatalogData> = {},
): FootballCatalogData {
  return {
    competitions: COMPETITIONS,
    teams: TEAMS,
    seasons: SEASONS,
    ...overrides,
  };
}

function team(overrides: Partial<TeamMetadata> & { id: string }): TeamMetadata {
  return {
    name: "Fixture FC",
    nameZh: "测试队",
    code: "FIX",
    aliases: [],
    colors: { primary: "#123456", secondary: "#FFFFFF" },
    crestRef: `crest.team.${overrides.id}`,
    ...overrides,
  };
}

const MINI_TEAMS: readonly TeamMetadata[] = [
  team({ id: "alpha", name: "Alpha Town", nameZh: "阿尔法", code: "ALP" }),
  team({ id: "beta", name: "Beta City", nameZh: "贝塔", code: "BET" }),
];

const MINI_COMPETITION = [COMPETITIONS[0]];
const MINI_SEASON: readonly SeasonRoster[] = [
  {
    id: "2025-26",
    competitionId: "premier-league",
    label: "2025/26",
    teamIds: ["alpha", "beta"],
  },
];

describe("英超元数据目录：查询（SC-014 / SPORT-001）", () => {
  it("默认目录包含 20 支球队与已登记赛季名单", () => {
    expect(footballCatalog.teams).toHaveLength(20);
    expect(footballCatalog.competitions.map((c) => c.id)).toEqual([
      "premier-league",
    ]);
    const season = footballCatalog.latestSeason();
    expect(season?.id).toBe("2025-26");
    expect(season?.teamIds).toHaveLength(20);
  });

  it("按稳定 ID 查询：Arsenal / Manchester City 等测试数据可用", () => {
    expect(footballCatalog.teamById("arsenal")).toMatchObject({
      name: "Arsenal",
      nameZh: "阿森纳",
      code: "ARS",
    });
    expect(footballCatalog.teamById("manchester-city")).toMatchObject({
      name: "Manchester City",
      nameZh: "曼城",
      code: "MCI",
    });
    expect(footballCatalog.teamById("no-such-team")).toBeUndefined();
  });

  it("按别名查询：大小写、全角与中文别名都能确定归属", () => {
    expect(footballCatalog.teamByAlias("MAN CITY")?.id).toBe("manchester-city");
    expect(footballCatalog.teamByAlias("manchester  city")?.id).toBe(
      "manchester-city",
    );
    expect(footballCatalog.teamByAlias("Ａｒｓｅｎａｌ")?.id).toBe("arsenal");
    expect(footballCatalog.teamByAlias("阿森纳")?.id).toBe("arsenal");
    expect(footballCatalog.teamByAlias("热刺")?.id).toBe("tottenham-hotspur");
    expect(footballCatalog.teamByAlias("Unknown Rovers")).toBeUndefined();
    expect(footballCatalog.teamByAlias("   ")).toBeUndefined();
  });

  it("规范名自动进入索引，不必重复写进 aliases", () => {
    const catalog = createFootballCatalog({
      competitions: MINI_COMPETITION,
      teams: MINI_TEAMS,
      seasons: MINI_SEASON,
    });
    expect(catalog.teamByAlias("alpha town")?.id).toBe("alpha");
    expect(catalog.teamByAlias("阿尔法")?.id).toBe("alpha");
  });

  it("联赛按 ID 查询", () => {
    expect(footballCatalog.competitionById("premier-league")).toMatchObject({
      label: "英超",
      nameEn: "Premier League",
      accent: "var(--semantic-sport)",
    });
    expect(footballCatalog.competitionById("champions-league")).toBeUndefined();
  });
});

describe("英超元数据目录：识别词表（SC-015 扫描标题用）", () => {
  it("球队词表包含规范名与别名，全部是已规范化的写法", () => {
    const entries = footballCatalog.teamAliasEntries;
    expect(entries).toContainEqual({
      text: "man city",
      teamId: "manchester-city",
    });
    expect(entries).toContainEqual({
      text: "manchester city",
      teamId: "manchester-city",
    });
    expect(entries).toContainEqual({ text: "阿森纳", teamId: "arsenal" });
    // 规范名（中英文）自动进入词表，不必重复写进 aliases。
    expect(entries).toContainEqual({
      text: "tottenham hotspur",
      teamId: "tottenham-hotspur",
    });
    expect(entries).toContainEqual({
      text: "热刺",
      teamId: "tottenham-hotspur",
    });
    // 词表与 teamByAlias 同源：任何一条写法都能查回球队。
    for (const entry of entries) {
      expect(footballCatalog.teamByAlias(entry.text)?.id).toBe(entry.teamId);
    }
  });

  it("联赛词表包含短标签、中英文名与别名", () => {
    const entries = footballCatalog.competitionAliasEntries;
    expect(entries).toContainEqual({
      text: "英超",
      competitionId: "premier-league",
    });
    expect(entries).toContainEqual({
      text: "premier league",
      competitionId: "premier-league",
    });
    expect(entries).toContainEqual({
      text: "epl",
      competitionId: "premier-league",
    });
  });

  it("联赛别名按同一套装配期规则校验（未规范化 / 跨联赛冲突被拒绝）", () => {
    expect(() =>
      createFootballCatalog(
        dataWith({
          competitions: [{ ...COMPETITIONS[0], aliases: ["Premier League"] }],
        }),
      ),
    ).toThrow(/联赛 premier-league 的别名未规范化/);
    expect(() =>
      createFootballCatalog(
        dataWith({
          competitions: [
            { ...COMPETITIONS[0], id: "league-a", aliases: ["shared cup"] },
            { ...COMPETITIONS[0], id: "league-b", aliases: ["shared cup"] },
          ],
        }),
      ),
    ).toThrow(/别名冲突：shared cup/);
  });
});

describe("英超元数据目录：赛季名单", () => {
  it("rosterOf 按名单顺序解析球队对象", () => {
    const roster = footballCatalog.rosterOf("2025-26");
    expect(roster).toHaveLength(20);
    expect(roster[0].id).toBe("arsenal");
    expect(roster.map((team) => team.id)).toContain("manchester-city");
    expect(footballCatalog.rosterOf("2099-00")).toEqual([]);
  });

  it("赛季变化只改数据：新增赛季后 latestSeason 跟随，查询逻辑不变", () => {
    const nextSeason: SeasonRoster = {
      id: "2026-27",
      competitionId: "premier-league",
      label: "2026/27",
      // 只登记“新赛季确认名单”，球队字典本身不动。
      teamIds: ["arsenal", "manchester-city", "sunderland"],
    };
    const catalog = createFootballCatalog(
      dataWith({ seasons: [nextSeason, ...SEASONS] }),
    );
    expect(catalog.latestSeason()?.id).toBe("2026-27");
    expect(catalog.rosterOf("2026-27").map((team) => team.id)).toEqual([
      "arsenal",
      "manchester-city",
      "sunderland",
    ]);
    // 旧赛季仍可查询，历史名单不被覆盖。
    expect(catalog.rosterOf("2025-26")).toHaveLength(20);
  });

  it("newestRosterContaining：两队同属某季才返回名单，供 SC-015 认定联赛", () => {
    expect(
      footballCatalog.newestRosterContaining("premier-league", [
        "arsenal",
        "manchester-city",
      ])?.id,
    ).toBe("2025-26");
    // 只认得一侧、或联赛未登记：拿不到证据，返回 undefined（不猜）。
    expect(
      footballCatalog.newestRosterContaining("premier-league", [
        "arsenal",
        "ghost-fc",
      ]),
    ).toBeUndefined();
    expect(
      footballCatalog.newestRosterContaining("champions-league", [
        "arsenal",
        "manchester-city",
      ]),
    ).toBeUndefined();
    // 多个赛季都收录时取最新一季（不依赖书写顺序）。
    const catalog = createFootballCatalog(
      dataWith({
        seasons: [
          {
            id: "2024-25",
            competitionId: "premier-league",
            label: "2024/25",
            teamIds: ["arsenal", "manchester-city"],
          },
          ...SEASONS,
        ],
      }),
    );
    expect(
      catalog.newestRosterContaining("premier-league", [
        "arsenal",
        "manchester-city",
      ])?.id,
    ).toBe("2025-26");
  });

  it("latestSeason 不依赖数据文件书写顺序", () => {
    const catalog = createFootballCatalog({
      competitions: MINI_COMPETITION,
      teams: MINI_TEAMS,
      seasons: [
        MINI_SEASON[0],
        {
          id: "2027-28",
          competitionId: "premier-league",
          label: "2027/28",
          teamIds: ["alpha", "beta"],
        },
      ],
    });
    expect(catalog.latestSeason()?.id).toBe("2027-28");
  });
});

describe("英超元数据目录：装配期校验（坏数据直接拒绝）", () => {
  it("球队 id / 代码重复被拒绝", () => {
    expect(() =>
      createFootballCatalog(
        dataWith({
          teams: [
            team({ id: "alpha", code: "AAA" }),
            team({ id: "alpha", code: "BBB" }),
          ],
        }),
      ),
    ).toThrow(/球队 id 重复/);
    expect(() =>
      createFootballCatalog(
        dataWith({
          teams: [
            team({
              id: "alpha",
              name: "Alpha Town",
              nameZh: "甲队",
              code: "AAA",
            }),
            team({
              id: "beta",
              name: "Beta Town",
              nameZh: "乙队",
              code: "AAA",
            }),
          ],
        }),
      ),
    ).toThrow(/球队代码重复/);
  });

  it("未规范化的别名被拒绝（避免出现两套写法）", () => {
    expect(() =>
      createFootballCatalog(
        dataWith({
          teams: [team({ id: "alpha", aliases: ["Man City"] })],
        }),
      ),
    ).toThrow(/别名未规范化/);
  });

  it("有歧义的简称（跨球队同键）被拒绝", () => {
    expect(() =>
      createFootballCatalog(
        dataWith({
          teams: [
            team({ id: "alpha", aliases: ["city"] }),
            team({ id: "beta", aliases: ["city"] }),
          ],
        }),
      ),
    ).toThrow(/别名冲突/);
  });

  it("同一球队重复别名被拒绝", () => {
    expect(() =>
      createFootballCatalog(
        dataWith({
          teams: [team({ id: "alpha", aliases: ["alpha fc", "alpha fc"] })],
        }),
      ),
    ).toThrow(/别名重复/);
  });

  it("颜色不合法或主副色相同被拒绝", () => {
    expect(() =>
      createFootballCatalog(
        dataWith({
          teams: [
            team({
              id: "alpha",
              colors: { primary: "red", secondary: "#FFFFFF" },
            }),
          ],
        }),
      ),
    ).toThrow(/主色不是 #RRGGBB/);
    expect(() =>
      createFootballCatalog(
        dataWith({
          teams: [
            team({
              id: "alpha",
              colors: { primary: "#FFFFFF", secondary: "#ffffff" },
            }),
          ],
        }),
      ),
    ).toThrow(/主副色相同/);
  });

  it("赛季引用未知球队 / 未知联赛 / 重复名单被拒绝", () => {
    const base = { competitions: MINI_COMPETITION, teams: MINI_TEAMS };
    expect(() =>
      createFootballCatalog({
        ...base,
        seasons: [{ ...MINI_SEASON[0], teamIds: ["alpha", "ghost"] }],
      }),
    ).toThrow(/引用了未知球队：ghost/);
    expect(() =>
      createFootballCatalog({
        ...base,
        seasons: [{ ...MINI_SEASON[0], competitionId: "unknown-league" }],
      }),
    ).toThrow(/引用了未知联赛/);
    expect(() =>
      createFootballCatalog({
        ...base,
        seasons: [{ ...MINI_SEASON[0], teamIds: ["alpha", "alpha"] }],
      }),
    ).toThrow(/名单重复：alpha/);
    expect(() =>
      createFootballCatalog({
        ...base,
        seasons: [{ ...MINI_SEASON[0], teamIds: [] }],
      }),
    ).toThrow(/名单为空/);
  });

  it("默认数据通过全部装配校验（数据文件与代码一致）", () => {
    expect(() => createFootballCatalog(dataWith())).not.toThrow();
  });
});
