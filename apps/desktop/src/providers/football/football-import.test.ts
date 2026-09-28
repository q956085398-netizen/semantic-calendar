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
      crestRef: "crest.team.unknown",
    });
    const reversed = importFixture(
      "New Rovers @ Arsenal - UEFA Champions League",
    ).fixture!;
    expect(reversed.teams[0].id).toBe("arsenal");
    const both = importFixture(
      "New Rovers vs Other FC - UEFA Champions League",
    ).fixture!;
    expect(both.teams.every((t) => t.crestRef === "crest.team.unknown")).toBe(
      true,
    );
  });
  it.each([
    "PSV vs Shakhtar - UEFA Champions League 2026/99 Round 1",
    "PSV vs Shakhtar - UEFA Champions League 2026/27 Round 1 tickets",
    "Arsenal vs New Rovers train - UEFA Champions League",
    "PSV vs Shakhtar - Premier League / UEFA Champions League",
    "New Rovers vs Other FC",
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
