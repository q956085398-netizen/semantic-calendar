import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Mark } from "./Mark";
import { CompetitionBackdrop } from "./CompetitionBackdrop";
import type { FixtureCompetitionDisplay } from "../semantic/metadata-resolver";

afterEach(cleanup);

/**
 * 标记渲染（SC-016 / app-spec §13 “Logo 缺失不破坏 UI”）。
 *
 * 解析层覆盖“没有引用 / 资源包没有该引用 / 资源包抛错”；
 * 这里补上渲染层独有的第四种情况：地址解析成功、图片加载失败——
 * 此时必须换成解析结果自带的 fallback，而不是留下破图。
 */

const COMPETITION: FixtureCompetitionDisplay = {
  id: "league",
  label: "联赛",
  nameZh: "甲级联赛",
  nameEn: "League",
  logoRef: "logo.competition.league",
  colors: { primary: "#37003C", secondary: "#00FF87" },
};

const ASSETS = { urlFor: (ref: string) => `/assets/${ref}.svg` };

describe("标记渲染的加载失败降级（SC-016）", () => {
  it("图片加载失败时换成 fallback 文字，不留破图", () => {
    render(
      <Mark
        resolution={{
          kind: "asset",
          ref: "crest.team.a",
          url: "/assets/crest.team.a.svg",
          fallback: {
            text: "TMA",
            colors: { primary: "#123456", secondary: "#FFFFFF" },
          },
        }}
        label="甲队"
      />,
    );

    const image = screen.getByRole("img", { name: "甲队" }) as HTMLImageElement;
    expect(image.tagName).toBe("IMG");
    // 固定容器属性：按需加载 + 异步解码（ui-design §22）。
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("decoding")).toBe("async");

    fireEvent.error(image);

    const fallback = screen.getByRole("img", { name: "甲队" });
    expect(fallback.tagName).toBe("SPAN");
    expect(fallback.textContent).toBe("TMA");
    expect(fallback.className).toContain("is-fallback");
  });

  it("联赛背景加载失败时换成短标签字形", () => {
    render(
      <CompetitionBackdrop
        competition={COMPETITION}
        className="match-cell-bg"
        assets={ASSETS}
      />,
    );

    const image = document.querySelector(
      ".match-cell-bg-image",
    ) as HTMLImageElement;
    expect(image).toBeTruthy();

    fireEvent.error(image);

    const backdrop = document.querySelector(".match-cell-bg") as HTMLElement;
    expect(backdrop.querySelector("img")).toBeNull();
    expect(backdrop.textContent).toBe("联赛");
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
  });

  it("资源包缺失时直接渲染 fallback，不创建 img", () => {
    render(
      <CompetitionBackdrop
        competition={COMPETITION}
        className="match-cell-bg"
      />,
    );

    const backdrop = document.querySelector(".match-cell-bg") as HTMLElement;
    expect(backdrop.querySelector("img")).toBeNull();
    expect(backdrop.textContent).toBe("联赛");
  });
});
