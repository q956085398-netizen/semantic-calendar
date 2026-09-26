import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { EnrichedEvent } from "../data/model";
import { MatchdayInspector } from "./MatchdayInspector";

afterEach(cleanup);

/**
 * 比赛日详情（SC-016 / SPORT-005、ui-design §13–15）。
 *
 * 关键规则是“缺字段就不渲染该行”：不填占位、不给默认值，
 * 天气在 v0.1 没有可靠来源，因此这一行从不出现（验收：缺字段时不显示伪造值）。
 * 组件只消费 Resolver 输出的对阵载荷与事件本身的 LOCATION，无领域判断。
 */

const EVENT: EnrichedEvent = {
  uid: "match-1",
  sourceId: "src-1",
  title: "Arsenal vs Manchester City",
  normalizedTitle: "Arsenal vs Manchester City",
  start: "2026-10-18T23:30:00",
  allDay: false,
  location: "Emirates Stadium",
  semantic: {
    type: "sport.fixture",
    subtype: "premier-league",
    matcherId: "football.fixture-title",
  },
  metadata: {
    accent: "var(--semantic-sport)",
    label: "英超",
    reminder: { kind: "minutes-before-start", minutes: 30 },
  },
};

const FIXTURE = {
  competition: {
    id: "premier-league",
    label: "英超",
    nameZh: "英格兰足球超级联赛",
    nameEn: "Premier League",
    logoRef: "logo.competition.premier-league",
    colors: { primary: "#37003C", secondary: "#00FF87" },
  },
  teams: [
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
  ],
} as const;

function renderMatchday(
  event: EnrichedEvent = EVENT,
  followedTeamIds: readonly string[] = [],
) {
  render(
    <MatchdayInspector
      fixture={{ ...FIXTURE, teams: [...FIXTURE.teams] }}
      event={event}
      followedTeamIds={followedTeamIds}
    />,
  );
  return screen.getByRole("region", { name: "阿森纳 对 曼城" });
}

/** 字段名 → 值；用于断言“行存在 / 行不存在”。 */
function factValue(panel: HTMLElement, label: string): string | null {
  const terms = [...panel.querySelectorAll("dt")];
  const term = terms.find((entry) => entry.textContent === label);
  return term?.nextElementSibling?.textContent ?? null;
}

describe("比赛日详情（SC-016 / SPORT-005）", () => {
  it("一级信息：两侧队徽、中英文名与联赛", () => {
    const panel = renderMatchday();

    expect(panel.querySelectorAll(".mark.is-fallback")).toHaveLength(2);
    expect(within(panel).getByText("Arsenal")).toBeTruthy();
    expect(within(panel).getByText("Manchester City")).toBeTruthy();
    expect(within(panel).getByText("阿森纳")).toBeTruthy();
    expect(within(panel).getByText("曼城")).toBeTruthy();
    expect(within(panel).getByText("VS")).toBeTruthy();
    // 联赛短标签：正文一行 + 低透明度背景水印（§13.2），两者同源。
    expect(panel.querySelector(".matchday-competition")?.textContent).toBe(
      "英超",
    );
    expect(panel.querySelector(".matchday-bg")?.textContent).toBe("英超");
  });

  it("开赛时间取自事件本身，场地取自 LOCATION，提醒取自 Resolver 策略", () => {
    const panel = renderMatchday();

    expect(factValue(panel, "开赛")).toBe("23:30");
    expect(factValue(panel, "场地")).toBe("Emirates Stadium");
    // 提醒是策略建议（NOTIFY-003），不是事件数据，因此按“建议提醒”呈现。
    expect(factValue(panel, "建议提醒")).toBe("赛前 30 分钟");
  });

  it("没有 LOCATION 时不渲染场地行（不填占位值）", () => {
    const withoutLocation: EnrichedEvent = { ...EVENT };
    delete withoutLocation.location;
    const panel = renderMatchday(withoutLocation);

    expect(factValue(panel, "场地")).toBeNull();
    // 其余可用字段照常显示。
    expect(factValue(panel, "开赛")).toBe("23:30");
  });

  it("全天比赛没有开赛时间，不渲染开赛行", () => {
    const allDay: EnrichedEvent = {
      ...EVENT,
      allDay: true,
      start: "2026-10-18",
    };
    const panel = renderMatchday(allDay);

    expect(factValue(panel, "开赛")).toBeNull();
    expect(factValue(panel, "建议提醒")).toBe("赛前 30 分钟");
  });

  it("天气在 v0.1 没有可靠来源：任何情况下都不出现", () => {
    const panel = renderMatchday();

    expect(panel.textContent).not.toContain("天气");
    expect(factValue(panel, "天气")).toBeNull();
  });

  it("关注球队在对应一侧标记，未关注的球队没有标记", () => {
    const panel = renderMatchday(EVENT, ["manchester-city"]);

    const marked = [...panel.querySelectorAll(".matchday-team")].filter(
      (team) => team.querySelector(".matchday-followed") !== null,
    );
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain("曼城");
    expect(within(panel).getAllByText("关注")).toHaveLength(1);
  });

  it("元数据缺失（无提醒策略）时只渲染可用字段", () => {
    const bare: EnrichedEvent = { ...EVENT, metadata: undefined };
    const panel = renderMatchday(bare);

    expect(factValue(panel, "建议提醒")).toBeNull();
    expect(factValue(panel, "开赛")).toBe("23:30");
    expect(factValue(panel, "场地")).toBe("Emirates Stadium");
  });
});
