// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../../data/model";
import { normalizeEventTitle } from "../../normalize/title";
import {
  createMatcherEngine,
  type EventMatcher,
} from "../../semantic/matcher-engine";
import { COMPETITIONS, SEASONS } from "./competitions";
import {
  createFootballCatalog,
  footballCatalog,
  type FootballCatalogData,
} from "./football-catalog";
import { createFootballMatcher, FOOTBALL_MATCHER_ID } from "./football-matcher";
import { TEAMS, type TeamMetadata } from "./teams";

/**
 * 英超比赛标题 Matcher（SC-015 / SPORT-002–003）。
 *
 * 测试只走公开接口：`EventMatcher.match`。标题按 SC-008 的口径给出
 * （normalizedTitle = normalizeEventTitle(title)），与真实管线一致。
 */

const matcher = createFootballMatcher(footballCatalog);

function eventWithTitle(title: string): NormalizedEvent {
  return {
    uid: "match-1",
    sourceId: "src-1",
    title,
    normalizedTitle: normalizeEventTitle(title),
    start: "2026-10-18T16:30:00Z",
    allDay: false,
  };
}

function match(title: string) {
  return matcher.match(eventWithTitle(title));
}

/** 构造带替换数据的目录：默认就是应用目录。 */
function catalogWith(
  overrides: Partial<FootballCatalogData> = {},
): ReturnType<typeof createFootballCatalog> {
  return createFootballCatalog({
    competitions: COMPETITIONS,
    teams: TEAMS,
    seasons: SEASONS,
    ...overrides,
  });
}

describe("英超比赛标题 Matcher：常见格式（SPORT-002）", () => {
  it("Arsenal vs Manchester City：识别为英超比赛，给出两队稳定 ID 与主客顺序", () => {
    expect(match("Arsenal vs Manchester City")).toEqual({
      type: "sport.fixture",
      subtype: "premier-league",
      entities: [
        { type: "team", id: "arsenal" },
        { type: "team", id: "manchester-city" },
      ],
      confidence: 0.8,
      reason: "「vs」左侧为主队；按 2025/26 名单推断联赛",
    });
  });
});

/** 断言识别出的两队顺序：第 0 个是主队、第 1 个是客队（SPORT-003）。 */
function expectTeams(title: string, ids: readonly string[]): void {
  const result = match(title);
  expect(result?.entities).toEqual(ids.map((id) => ({ type: "team", id })));
  expect(result?.subtype).toBe("premier-league");
}

describe("英超比赛标题 Matcher：对阵分隔符与主客顺序（SPORT-002–003）", () => {
  it("`-` 与 `vs` 同义：左侧为主队", () => {
    expectTeams("Arsenal - Manchester City", ["arsenal", "manchester-city"]);
    expect(match("Arsenal - Manchester City")?.reason).toContain(
      "「-」左侧为主队",
    );
  });

  it("`@` 明示左侧客场作战：右侧为主队，entities 顺序随之翻转", () => {
    expectTeams("Manchester City @ Arsenal", ["arsenal", "manchester-city"]);
    expect(match("Manchester City @ Arsenal")).toMatchObject({
      confidence: 0.8,
      reason: "「@」右侧为主队；按 2025/26 名单推断联赛",
    });
  });

  it("常见变体：vs. / v / versus / 短横线都按“左主右客”处理", () => {
    for (const title of [
      "Arsenal vs. Manchester City",
      "Arsenal v Manchester City",
      "Arsenal v. Manchester City",
      "Arsenal versus Manchester City",
      "Arsenal – Manchester City",
      "Arsenal–Manchester City",
    ]) {
      expectTeams(title, ["arsenal", "manchester-city"]);
    }
  });

  it("大小写、多余空格、全角与别名 / 中文写法都能命中", () => {
    expectTeams("ARSENAL vs MANCHESTER CITY", ["arsenal", "manchester-city"]);
    expectTeams("  arsenal   vs   man   city  ", [
      "arsenal",
      "manchester-city",
    ]);
    expectTeams("Ａｒｓｅｎａｌ vs Ｍａｎｃｈｅｓｔｅｒ Ｃｉｔｙ", [
      "arsenal",
      "manchester-city",
    ]);
    expectTeams("Man City vs Spurs", ["manchester-city", "tottenham-hotspur"]);
    expectTeams("阿森纳 vs 曼城", ["arsenal", "manchester-city"]);
    expectTeams("阿森纳对曼城", ["arsenal", "manchester-city"]);
    expectTeams("曼城 @ 阿森纳", ["arsenal", "manchester-city"]);
  });
});

describe("英超比赛标题 Matcher：联赛认定（SPORT-002 / competition）", () => {
  it("标题写明联赛：短标签 / 中英文名 / 别名都算明示", () => {
    for (const title of [
      "Premier League: Arsenal vs Manchester City",
      "Arsenal vs Manchester City (Premier League)",
      "英超：阿森纳 vs 曼城",
      "EPL: Arsenal vs Manchester City",
      "英格兰足球超级联赛 阿森纳 vs 曼城",
    ]) {
      expectTeams(title, ["arsenal", "manchester-city"]);
      // 联赛明示，但主客方向来自 vs 惯例：置信度取两项证据里较弱的一项。
      expect(match(title)).toMatchObject({
        confidence: 0.9,
        reason: expect.stringContaining("标题标注联赛「英超」"),
      });
    }
    // 联赛明示 + `@` 明示方向：两项证据都硬，置信度满。
    expect(match("Premier League: Manchester City @ Arsenal")).toMatchObject({
      confidence: 1,
      reason: "「@」右侧为主队；标题标注联赛「英超」",
    });
  });

  it("标题未写联赛：两队同属已登记名单即可认定，置信度低于明示", () => {
    expect(match("Matchday 12: Arsenal vs Manchester City")).toMatchObject({
      confidence: 0.8,
      reason: "「vs」左侧为主队；按 2025/26 名单推断联赛",
    });
  });

  it("名单跟随赛季数据：新赛季名单同样可用（不必改 Matcher）", () => {
    const custom = createFootballMatcher(
      catalogWith({
        seasons: [
          {
            id: "2026-27",
            competitionId: "premier-league",
            label: "2026/27",
            teamIds: ["arsenal", "sunderland"],
          },
          ...SEASONS,
        ],
      }),
    );
    const result = custom.match(eventWithTitle("Arsenal vs Sunderland"));
    expect(result?.entities).toEqual([
      { type: "team", id: "arsenal" },
      { type: "team", id: "sunderland" },
    ]);
    expect(result?.reason).toContain("2026/27");
  });

  it("名单证据是必需的：对手不在联赛名单内就不增强（P-03）", () => {
    const rival: TeamMetadata = {
      id: "rival-fc",
      name: "Rival FC",
      nameZh: "对手队",
      code: "RIV",
      aliases: [],
      colors: { primary: "#123456", secondary: "#FFFFFF" },
      crestRef: "crest.team.rival-fc",
    };
    const custom = createFootballMatcher(
      catalogWith({ teams: [...TEAMS, rival] }),
    );
    // 两队都认得出，但没有任何已登记名单同时收录它们：不猜联赛。
    expect(custom.match(eventWithTitle("Arsenal vs Rival FC"))).toBeNull();
    // 标题写明英超也一样——与名单矛盾时不增强，而不是给出可能错的联赛。
    expect(
      custom.match(eventWithTitle("Premier League: Arsenal vs Rival FC")),
    ).toBeNull();
  });

  it("两队同属多个联赛名单时不猜；标题写明联赛时才落地", () => {
    const second = {
      ...COMPETITIONS[0],
      id: "super-cup",
      label: "超级杯",
      name: "超级杯赛",
      nameEn: "Super Cup",
      aliases: [],
    };
    const custom = createFootballMatcher(
      catalogWith({
        competitions: [COMPETITIONS[0], second],
        seasons: [
          SEASONS[0],
          {
            id: "2025-26-super-cup",
            competitionId: "super-cup",
            label: "2025/26",
            teamIds: ["arsenal", "manchester-city"],
          },
        ],
      }),
    );
    expect(
      custom.match(eventWithTitle("Arsenal vs Manchester City")),
    ).toBeNull();
    expect(
      custom.match(eventWithTitle("Premier League: Arsenal vs Manchester City"))
        ?.subtype,
    ).toBe("premier-league");
    // 两个联赛名同时出现：自相矛盾，不猜。
    expect(
      custom.match(
        eventWithTitle(
          "Premier League / Super Cup: Arsenal vs Manchester City",
        ),
      ),
    ).toBeNull();
  });
});

describe("英超比赛标题 Matcher：不增强的情况（P-03 / SEM-003）", () => {
  it("明显非足球的普通事件不受影响", () => {
    for (const title of [
      "Team meeting",
      "Sprint review - 复盘",
      "Arsenal tickets on sale",
      "Christmas Eve dinner",
      "Sunrise yoga",
      "英超赛程讨论",
      "Premier League fixtures released",
    ]) {
      expect(match(title)).toBeNull();
    }
  });

  it("只有一支球队、或对手不在字典里：不增强", () => {
    for (const title of [
      "Arsenal vs Barcelona",
      "Arsenal training",
      "阿森纳主场",
    ]) {
      expect(match(title)).toBeNull();
    }
  });

  it("同一支球队出现两次、或三支球队并列：不增强", () => {
    for (const title of [
      "Arsenal vs Arsenal",
      "Arsenal vs Chelsea vs Tottenham",
      "Arsenal vs Manchester City vs Chelsea",
    ]) {
      expect(match(title)).toBeNull();
    }
  });

  it("没有对阵分隔符、或分隔符是比分 / 连接词：不增强", () => {
    for (const title of [
      "Arsenal Manchester City",
      "Arsenal 3-1 Manchester City",
      "Arsenal & Manchester City",
      "Arsenal: Manchester City",
      "Arsenal (Manchester City)",
    ]) {
      expect(match(title)).toBeNull();
    }
  });

  it("两侧必须是球队名本身，而不是“包含球队名的短语”", () => {
    // 这些标题里两队都在词表里、也都有分隔符，但讲的是别的事
    // （展览 / 车次 / 球票 / 赛后比分 / 场地）——普通日历里这类条目最常见，
    // 误判成英超比赛就等于给一次展览挂上了队徽。
    for (const title of [
      "Kensington Palace - Chelsea Flower Show",
      "Brighton - Leeds train",
      "Brighton - Leeds (train)",
      "Liverpool - Everton derby tickets",
      "Arsenal vs Manchester City 3-1",
      "Arsenal vs Manchester City, Emirates Stadium",
      "Arsenal vs Manchester City (Emirates Stadium)",
      "Arsenal vs Manchester City matchday 12",
    ]) {
      expect(match(title)).toBeNull();
    }
  });

  it("装饰仍然允许：联赛名在括号里、`标签: ` 前缀、表情符号不影响识别", () => {
    expectTeams("Arsenal vs Manchester City (Premier League)", [
      "arsenal",
      "manchester-city",
    ]);
    expectTeams("Arsenal vs Manchester City（英超）", [
      "arsenal",
      "manchester-city",
    ]);
    expectTeams("Matchday 12: Arsenal vs Manchester City", [
      "arsenal",
      "manchester-city",
    ]);
    expectTeams("⚽ Arsenal vs Manchester City", [
      "arsenal",
      "manchester-city",
    ]);
    expectTeams("Re: Fwd: Arsenal vs Manchester City", [
      "arsenal",
      "manchester-city",
    ]);
  });

  it("词边界：球队名藏在更长的单词里不算命中", () => {
    for (const title of [
      "Arsenals vs Manchester City",
      "xArsenal vs Manchester City",
      "Chelsea vs Leedside",
      "Manchestering City vs Arsenal",
    ]) {
      expect(match(title)).toBeNull();
    }
  });
});

describe("英超比赛标题 Matcher：与引擎一起工作（SC-009 + SC-015）", () => {
  it("matcherId 由引擎盖戳，实现方无法冒名（SEM-002）", () => {
    const engine = createMatcherEngine([matcher]);
    const result = engine.match(eventWithTitle("Arsenal vs Manchester City"));
    expect(result?.semantic.matcherId).toBe(FOOTBALL_MATCHER_ID);
    expect(result?.matcherId).toBe(FOOTBALL_MATCHER_ID);
  });

  it("注册顺序：按日期判定的 Matcher 先于标题型（priority 约定）", () => {
    const dateMatcher: EventMatcher = {
      id: "holiday.test",
      priority: 10,
      match: () => null,
    };
    const engine = createMatcherEngine([matcher, dateMatcher]);
    expect(engine.order).toEqual(["holiday.test", FOOTBALL_MATCHER_ID]);
  });
});
