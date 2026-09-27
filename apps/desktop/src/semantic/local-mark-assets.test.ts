import { describe, expect, it } from "vitest";
import { parseLocalMarkAssets } from "./local-mark-assets";
import { resolveTeamMark } from "./marks";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5E0AAAAASUVORK5CYII=";
const team = {
  id: "arsenal",
  nameZh: "阿森纳",
  nameEn: "Arsenal",
  code: "ARS",
  crestRef: "crest.team.arsenal",
  colors: { primary: "#EF0107", secondary: "#FFFFFF" },
};

describe("本地标记资源包", () => {
  it("离线图片按完整逻辑引用匹配，不按名字或前缀猜测", () => {
    const assets = parseLocalMarkAssets(
      JSON.stringify({
        version: 1,
        assets: [{ ref: team.crestRef, dataUrl: png }],
      }),
    );
    expect(resolveTeamMark(team, assets)).toMatchObject({
      kind: "asset",
      url: png,
    });
    expect(assets.urlFor("crest.team.arsenal-women")).toBeUndefined();
    expect(assets.urlFor("logo.competition.premier-league")).toBeUndefined();
  });
  it("缺少资源包或球队资源时使用原有文字回退", () => {
    expect(resolveTeamMark(team, parseLocalMarkAssets(null))).toMatchObject({
      kind: "fallback",
      text: "ARS",
    });
    expect(
      resolveTeamMark(team, parseLocalMarkAssets('{"version":1,"assets":[]}')),
    ).toMatchObject({ kind: "fallback", text: "ARS" });
  });
  it("拒绝远程 URL、SVG、重复映射及未知包版本", () => {
    for (const dataUrl of [
      "https://example.com/logo.png",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/png;base64,broken",
    ]) {
      expect(() =>
        parseLocalMarkAssets(
          JSON.stringify({
            version: 1,
            assets: [{ ref: team.crestRef, dataUrl }],
          }),
        ),
      ).toThrow();
    }
    const asset = { ref: team.crestRef, dataUrl: png };
    expect(() =>
      parseLocalMarkAssets(
        JSON.stringify({ version: 1, assets: [asset, asset] }),
      ),
    ).toThrow();
    expect(() => parseLocalMarkAssets('{"version":2,"assets":[]}')).toThrow();
    expect(() => parseLocalMarkAssets("not json")).toThrow();
  });
});
