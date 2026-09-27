// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { footballCatalog } from "./football-catalog";

describe("本赛季图片映射与领域名单", () => {
  it("图片映射恰好覆盖本赛季 20 队，新增球队可按中英文识别", () => {
    const pack = JSON.parse(
      readFileSync(
        new URL("../../../tools/premier-league-assets.json", import.meta.url),
        "utf8",
      ),
    );
    const roster = footballCatalog.rosterOf(pack.season);
    expect(roster).toHaveLength(20);
    expect(Object.keys(pack.teams).sort()).toEqual(
      roster.map((team) => team.id).sort(),
    );
    for (const [alias, id] of [
      ["Coventry City", "coventry-city"],
      ["考文垂", "coventry-city"],
      ["Hull City", "hull-city"],
      ["赫尔城", "hull-city"],
      ["Ipswich Town", "ipswich-town"],
      ["伊普斯维奇", "ipswich-town"],
    ]) {
      expect(footballCatalog.teamByAlias(alias)?.id).toBe(id);
    }
    expect(footballCatalog.rosterOf("2025-26")).toHaveLength(20);
  });
});
