import { describe, expect, it } from "vitest";
import { parseIcsCalendar } from "../../ics/parse-ics";
import { createAppSemanticStack } from "../../semantic/app-registry";
import { displayMetadataOf } from "../../semantic/metadata-resolver";
import { cellBackdropOf } from "../../calendar/cell-backdrop";
import { normalizeEventTitle } from "../../normalize/title";
import { unknownTeamDisplay } from "./unknown-team";

const stack = createAppSemanticStack();
function importFixture(title: string) {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:fixture-1",
    "DTSTART:20260911T030000Z",
    `SUMMARY:${title}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const [raw] = parseIcsCalendar(ics).events;
  const event = {
    ...raw,
    sourceId: "local-ics:football",
    normalizedTitle: normalizeEventTitle(raw.title),
  };
  const result = stack.engine.match(event);
  const metadata = result
    ? stack.resolver?.resolve(result.semantic, event)
    : undefined;
  return { event, result, fixture: displayMetadataOf({ metadata })?.fixture };
}

describe("足球 ICS 导入到展示载荷", () => {
  it.each([
    "Crystal Palace vs Nott'm Forest - English Premier League 2026/27 Round 6",
    "Ipswich vs Nott'm Forest - English Premier League 2026/27 Round 8",
    "Sunderland vs Nott'm Forest - English Premier League 2026/27 Round 15",
  ])("截图中的 %s 应显示为对阵", (title) => {
    const imported = importFixture(title);
    expect(imported.result?.semantic.type).toBe("sport.fixture");
    expect(imported.fixture?.teams.map((team) => team.id)).toEqual([
      expect.any(String),
      "nottingham-forest",
    ]);
  });
  it.each([
    ["PSV vs Shakhtar", "psv", "shakhtar-donetsk"],
    ["Fenerbahçe vs Roma", "fenerbahce", "roma"],
    ["Bayern München vs Bodø/Glimt", "bayern-munich", "bodo-glimt"],
    ["Man Utd vs Sabah", "manchester-united", "sabah"],
    ["Slavia Praha vs Lens", "slavia-prague", "lens"],
  ])("%s：真实导入识别双方与欧冠标识", (match, home, away) => {
    const title = `${match} - UEFA Champions League 2026/27 Round 1`;
    const imported = importFixture(title);
    expect(imported.event.title).toBe(title);
    expect(imported.result?.semantic.subtype).toBe("champions-league");
    expect(imported.fixture?.teams.map((t) => t.id)).toEqual([home, away]);
    expect(imported.fixture?.competition.logoRef).toBe(
      "logo.competition.champions-league",
    );
  });
  it("球队跨赛事只更换赛事图标；未标赛事的比赛使用中性背景", () => {
    const domestic = importFixture(
      "Arsenal vs Man City - Premier League",
    ).fixture!;
    const european = importFixture(
      "Arsenal vs Man City - UEFA Champions League",
    ).fixture!;
    expect(european.teams.map((t) => t.crestRef)).toEqual(
      domestic.teams.map((t) => t.crestRef),
    );
    const neutral = importFixture("Arsenal vs Man City").fixture!;
    expect(cellBackdropOf({ fixtures: [{ fixture: neutral }] })).toEqual({
      kind: "none",
    });
  });
  it("未收录球队保留名称并显示通用队徽；已知一侧正常解析", () => {
    const fixture = importFixture(
      "Arsenal vs New Rovers - UEFA Champions League 2026/27 Round 1",
    ).fixture!;
    expect(fixture.teams[0].crestRef).toBe("crest.team.arsenal");
    expect(fixture.teams[1]).toMatchObject({
      nameEn: "New Rovers",
      crestRef: expect.stringMatching(/^crest\.team\.custom-new-rovers-/),
    });
    const reversed = importFixture(
      "New Rovers @ Arsenal - UEFA Champions League",
    ).fixture!;
    expect(reversed.teams[0].id).toBe("arsenal");
    const both = importFixture(
      "New Rovers vs Other FC - UEFA Champions League",
    ).fixture!;
    expect(
      both.teams.every((t) => t.crestRef?.startsWith("crest.team.custom-")),
    ).toBe(true);
  });
  it("欧国联使用与欧冠相同的对阵模板，并保留未知国家队的专属队徽位置", () => {
    const imported = importFixture(
      "Iceland vs Estonia - UEFA Nations League 2026/27 Round 1",
    );
    expect(imported.result?.semantic.subtype).toBe("nations-league");
    expect(imported.fixture?.teams[0].id).toBe("national-iceland");
    expect(imported.fixture?.teams[1].crestRef).toMatch(
      /^crest\.team\.custom-estonia-/,
    );
    expect(imported.fixture?.competition.logoRef).toBe(
      "logo.competition.nations-league",
    );
  });
  it("未登记赛事但标题明确写出赛季时仍产生完整对阵", () => {
    const imported = importFixture(
      "China vs Japan - East Asia Cup 2026/27 Round 1",
    );
    expect(imported.result?.semantic.type).toBe("sport.fixture");
    expect(imported.fixture?.teams.map((team) => team.id)).toEqual([
      "national-china",
      "national-japan",
    ]);
    expect(imported.fixture?.competition.logoRef).toMatch(
      /^logo\.competition\.custom-east-asia-cup-/,
    );
  });
  it.each([
    "PSV vs Shakhtar - UEFA Champions League 2026/99 Round 1",
    "PSV vs Shakhtar - UEFA Champions League 2026/27 Round 1 tickets",
    "Arsenal vs New Rovers train - UEFA Champions League",
    "PSV vs Shakhtar - Premier League / UEFA Champions League",
    "New Rovers vs Other FC",
    "Arsenal vs Chelsea - Project Meeting Round 2",
  ])("不把无效或矛盾标题 %s 猜成赛事", (title) => {
    expect(importFixture(title).result).toBeNull();
  });
  it("未知实体读取拒绝损坏编码与超长名称", () => {
    expect(unknownTeamDisplay("unknown-team:%GG")).toBeUndefined();
    expect(
      unknownTeamDisplay("unknown-team:" + "a".repeat(81)),
    ).toBeUndefined();
  });
});
