// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedEvent, SemanticEvent } from "../../data/model";
import { importLocalIcs } from "../../data/import/import-local-ics";
import { CalendarStore } from "../../data/store/calendar-store";
import { NodeFileIO } from "../../data/store/node-file-io";
import { reEnrichStore } from "../../semantic/enrich";
import { createMatcherEngine } from "../../semantic/matcher-engine";
import {
  createBuiltinTypeMetadataResolver,
  createMetadataResolver,
  displayMetadataOf,
} from "../../semantic/metadata-resolver";
import { resolveTeamCrest } from "./crests";
import { COMPETITIONS, SEASONS } from "./competitions";
import { createFootballCatalog, footballCatalog } from "./football-catalog";
import { createFootballMatcher } from "./football-matcher";
import { createFootballMetadataResolver } from "./football-metadata-resolver";
import { TEAMS } from "./teams";

const EVENT: NormalizedEvent = {
  uid: "match-1",
  sourceId: "src-1",
  title: "Arsenal vs Manchester City",
  normalizedTitle: "Arsenal vs Manchester City",
  start: "2026-10-18T16:30:00Z",
  allDay: false,
};

function fixtureSemantic(
  competition: string | undefined,
  teamIds: readonly string[],
  extraEntities: SemanticEvent["entities"] = [],
): SemanticEvent {
  return {
    type: "sport.fixture",
    ...(competition === undefined ? {} : { subtype: competition }),
    entities: [
      ...teamIds.map((id) => ({ type: "team", id })),
      ...(extraEntities ?? []),
    ],
    matcherId: "football-v0",
  };
}

const resolver = createFootballMetadataResolver(footballCatalog);

describe("足球赛事 Metadata Resolver（SC-014 / app-spec §7.5）", () => {
  it("英超比赛：联赛短标签、Logo 引用、双方展示信息与默认提醒", () => {
    const metadata = resolver.resolve(
      fixtureSemantic("premier-league", ["arsenal", "manchester-city"]),
      EVENT,
    );
    expect(metadata).toMatchObject({
      accent: "var(--semantic-sport)",
      label: "英超",
      reminder: { kind: "minutes-before-start", minutes: 30 },
      fixture: {
        competition: {
          id: "premier-league",
          label: "英超",
          nameZh: "英格兰足球超级联赛",
          nameEn: "Premier League",
          logoRef: "logo.competition.premier-league",
          colors: { primary: "#37003C", secondary: "#00FF87" },
        },
      },
    });
    expect(metadata?.fixture?.teams).toEqual([
      {
        id: "arsenal",
        nameZh: "阿森纳",
        nameEn: "Arsenal",
        code: "ARS",
        crestRef: "crest.team.arsenal",
        colors: { primary: "#EF0107", secondary: "#FFFFFF" },
      },
      {
        id: "manchester-city",
        nameZh: "曼城",
        nameEn: "Manchester City",
        code: "MCI",
        crestRef: "crest.team.manchester-city",
        colors: { primary: "#6CABDD", secondary: "#1C2C5B" },
      },
    ]);
  });

  it("联赛语义色来自联赛数据（改数据即可换强调色，无需改代码）", () => {
    const custom = createFootballCatalog({
      competitions: [
        { ...COMPETITIONS[0], accent: "var(--custom-league-accent)" },
      ],
      teams: TEAMS,
      seasons: SEASONS,
    });
    expect(
      createFootballMetadataResolver(custom).resolve(
        fixtureSemantic("premier-league", ["arsenal", "manchester-city"]),
        EVENT,
      ),
    ).toMatchObject({ accent: "var(--custom-league-accent)" });
  });

  it("球队顺序跟随语义实体顺序（主客队顺序由 SC-015 决定）", () => {
    const metadata = resolver.resolve(
      fixtureSemantic("premier-league", ["manchester-city", "arsenal"]),
      EVENT,
    );
    expect(metadata?.fixture?.teams.map((team) => team.id)).toEqual([
      "manchester-city",
      "arsenal",
    ]);
  });

  it("重复实体只保留首次；未登记球队被跳过，剩下的两队照常展示", () => {
    const metadata = resolver.resolve(
      fixtureSemantic("premier-league", [
        "arsenal",
        "arsenal",
        "ghost-fc",
        "manchester-city",
      ]),
      EVENT,
    );
    expect(metadata?.fixture?.teams.map((team) => team.id)).toEqual([
      "arsenal",
      "manchester-city",
    ]);
  });

  it("非球队实体（如球员 / 裁判）不进入展示载荷", () => {
    const metadata = resolver.resolve(
      fixtureSemantic(
        "premier-league",
        ["arsenal", "chelsea"],
        [{ type: "player", id: "some-player" }],
      ),
      EVENT,
    );
    expect(metadata?.fixture?.teams.map((team) => team.id)).toEqual([
      "arsenal",
      "chelsea",
    ]);
  });

  it("可解析球队不足两支时返回 null：半场对阵不成比赛（SPORT-004）", () => {
    expect(
      resolver.resolve(fixtureSemantic("premier-league", ["ghost-fc"]), EVENT),
    ).toBeNull();
    expect(
      resolver.resolve(fixtureSemantic("premier-league", []), EVENT),
    ).toBeNull();
    // 只认得出一侧时同样不展示对阵，退回通用体育语义。
    expect(
      resolver.resolve(
        fixtureSemantic("premier-league", ["arsenal", "ghost-fc"]),
        EVENT,
      ),
    ).toBeNull();
    expect(
      resolver.resolve({ type: "sport.fixture", matcherId: "m" }, EVENT),
    ).toBeNull();
  });

  it("未登记的联赛或非比赛语义一律返回 null，交给后续 Resolver", () => {
    expect(
      resolver.resolve(
        fixtureSemantic("champions-league", ["arsenal", "chelsea"]),
        EVENT,
      ),
    ).toBeNull();
    expect(
      resolver.resolve(
        fixtureSemantic(undefined, ["arsenal", "chelsea"]),
        EVENT,
      ),
    ).toBeNull();
    expect(
      resolver.resolve({ type: "holiday", matcherId: "m" }, EVENT),
    ).toBeNull();
  });
});

describe("与解析链和读取边界一起工作（SC-009 + SC-014）", () => {
  const stack = createMetadataResolver([
    createFootballMetadataResolver(footballCatalog),
    createBuiltinTypeMetadataResolver(),
  ]);

  it("已登记联赛命中 Provider：标签为“英超”，且保留默认提醒", () => {
    const metadata = stack.resolve(
      fixtureSemantic("premier-league", ["arsenal", "manchester-city"]),
      EVENT,
    );
    expect(metadata).toMatchObject({
      label: "英超",
      reminder: { kind: "minutes-before-start", minutes: 30 },
    });
  });

  it("未登记联赛落回内置默认值：通用标签 + 默认提醒（SEM-003）", () => {
    expect(
      stack.resolve(
        fixtureSemantic("champions-league", ["arsenal", "chelsea"]),
        EVENT,
      ),
    ).toMatchObject({ label: "体育赛事", accent: "var(--semantic-sport)" });
  });

  it("普通事件仍然没有展示元数据", () => {
    expect(stack.resolve({ type: "calendar.event" }, EVENT)).toBeNull();
  });

  it("读取边界保留合法 fixture，并丢弃畸形部分", () => {
    const metadata = stack.resolve(
      fixtureSemantic("premier-league", ["arsenal", "manchester-city"]),
      EVENT,
    );
    const narrowed = displayMetadataOf({ metadata });
    expect(narrowed?.fixture?.teams.map((team) => team.code)).toEqual([
      "ARS",
      "MCI",
    ]);

    // 磁盘 JSON 可能被改写：畸形球队被丢弃，其余两侧仍可渲染。
    const malformed = displayMetadataOf({
      metadata: {
        ...metadata,
        fixture: {
          competition: {
            id: "premier-league",
            label: "英超",
            nameZh: "英格兰足球超级联赛",
            nameEn: "Premier League",
            colors: { primary: "#37003C", secondary: "#00FF87" },
          },
          teams: [
            {
              id: "arsenal",
              nameZh: "阿森纳",
              nameEn: "Arsenal",
              code: "ARS",
              colors: { primary: "#EF0107", secondary: "#FFFFFF" },
            },
            { id: "broken", nameZh: "缺字段" },
            {
              id: "manchester-city",
              nameZh: "曼城",
              nameEn: "Manchester City",
              code: "MCI",
              colors: { primary: "#6CABDD", secondary: "#1C2C5B" },
            },
          ],
        },
      },
    });
    expect(malformed?.fixture?.teams.map((team) => team.id)).toEqual([
      "arsenal",
      "manchester-city",
    ]);

    // 联赛块缺失、只剩一侧、或整块不是对象时，整块丢弃而不是渲染半张卡片。
    expect(
      displayMetadataOf({
        metadata: { ...metadata, fixture: { teams: [] } },
      })?.fixture,
    ).toBeUndefined();
    expect(
      displayMetadataOf({
        metadata: {
          ...metadata,
          fixture: {
            competition: {
              id: "premier-league",
              label: "英超",
              nameZh: "英格兰足球超级联赛",
              nameEn: "Premier League",
              colors: { primary: "#37003C", secondary: "#00FF87" },
            },
            teams: [
              {
                id: "arsenal",
                nameZh: "阿森纳",
                nameEn: "Arsenal",
                code: "ARS",
                colors: { primary: "#EF0107", secondary: "#FFFFFF" },
              },
            ],
          },
        },
      })?.fixture,
    ).toBeUndefined();
    expect(
      displayMetadataOf({
        metadata: { fixture: "not-an-object" },
      })?.fixture,
    ).toBeUndefined();
  });
});

describe("集成：ICS 导入 → Matcher 识别 → 元数据解析 → 队徽 fallback", () => {
  let dataDir: string;
  let store: CalendarStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "semantic-calendar-football-"));
    store = (
      await CalendarStore.open(
        new NodeFileIO(),
        path.join(dataDir, "calendar-store.json"),
      )
    ).store;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("真实链路：Arsenal vs Manchester City 得到双方展示信息与 fallback 队标", async () => {
    await importLocalIcs(store, {
      fileName: "premier-league.ics",
      contents: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:pl-match@example.com",
        "SUMMARY:Arsenal vs Manchester City",
        "DTSTART:20261018T163000Z",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    });

    // SC-015 的 Matcher 驱动真实管线：标题识别 → 语义 → 元数据。
    const engine = createMatcherEngine([
      createFootballMatcher(footballCatalog),
    ]);

    reEnrichStore(store, {
      engine,
      resolver: createMetadataResolver([
        createFootballMetadataResolver(footballCatalog),
        createBuiltinTypeMetadataResolver(),
      ]),
    });

    const [enriched] = store.listEnrichedEvents();
    expect(enriched.semantic).toMatchObject({
      type: "sport.fixture",
      subtype: "premier-league",
    });
    const metadata = displayMetadataOf(enriched);
    expect(metadata?.label).toBe("英超");
    expect(metadata?.fixture?.competition.nameEn).toBe("Premier League");
    const teams = metadata?.fixture?.teams ?? [];
    expect(teams.map((team) => team.nameZh)).toEqual(["阿森纳", "曼城"]);
    // Logo 资源缺失不会破坏展示：月格拿到的是可渲染的 fallback 标记。
    expect(teams.map((team) => resolveTeamCrest(team))).toEqual([
      {
        kind: "fallback",
        ref: "crest.team.arsenal",
        text: "ARS",
        colors: { primary: "#EF0107", secondary: "#FFFFFF" },
      },
      {
        kind: "fallback",
        ref: "crest.team.manchester-city",
        text: "MCI",
        colors: { primary: "#6CABDD", secondary: "#1C2C5B" },
      },
    ]);
  });
});
