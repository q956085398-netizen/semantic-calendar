import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { InspectorPanel } from "./InspectorPanel";
import type { EnrichedEvent } from "../data/model";

afterEach(cleanup);

/**
 * SC-009：详情栏对语义增强的通用消费。
 * 短标签与 accent 全部来自 Metadata Resolver，组件无领域判断。
 */

const MATCH: EnrichedEvent = {
  uid: "match-1",
  sourceId: "src-1",
  title: "Arsenal vs Manchester City",
  normalizedTitle: "Arsenal vs Manchester City",
  start: "2026-10-18T12:00:00.000Z",
  allDay: false,
  semantic: {
    type: "sport.fixture",
    subtype: "premier-league",
    matcherId: "football-v0",
  },
  metadata: {
    accent: "var(--semantic-sport)",
    label: "体育赛事",
    reminder: { kind: "minutes-before-start", minutes: 30 },
  },
};

const PLAIN: EnrichedEvent = {
  uid: "plain-1",
  sourceId: "src-1",
  title: "每周站会",
  normalizedTitle: "每周站会",
  start: "2026-10-18T09:00:00",
  allDay: false,
};

describe("详情栏事件列表的语义增强显示（SC-009）", () => {
  it("增强事件显示语义短标签与 accent 条", () => {
    render(<InspectorPanel dateKey="2026-10-18" events={[MATCH, PLAIN]} />);

    const enhanced = screen
      .getByText("Arsenal vs Manchester City")
      .closest("li") as HTMLElement;
    expect(enhanced.className).toContain("is-semantic");
    expect(enhanced.getAttribute("data-semantic-type")).toBe("sport.fixture");
    expect(enhanced.style.getPropertyValue("--event-accent")).toBe(
      "var(--semantic-sport)",
    );
    expect(within(enhanced).getByText("体育赛事")).toBeTruthy();
  });

  it("未匹配事件保持普通卡片：无标签、无 accent（SEM-003）", () => {
    render(<InspectorPanel dateKey="2026-10-18" events={[MATCH, PLAIN]} />);

    const plain = screen.getByText("每周站会").closest("li");
    expect(plain?.className).toBe("inspector-event");
    expect(plain?.hasAttribute("style")).toBe(false);
    expect(within(plain!).queryByText("体育赛事")).toBeNull();
    // 标题与时间照常显示。
    expect(within(plain!).getByText("09:00")).toBeTruthy();
  });
});

/** SC-016：带完整对阵载荷的比赛事件。 */
const FIXTURE_EVENT: EnrichedEvent = {
  ...MATCH,
  location: "Emirates Stadium",
  metadata: {
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
    },
  },
};

describe("比赛日详情栏模式（SC-016 / SPORT-005 / ui-design §13）", () => {
  it("当日有比赛时进入比赛模式：星期行追加 MATCHDAY，比赛成为视觉中心", () => {
    render(<InspectorPanel dateKey="2026-10-18" events={[FIXTURE_EVENT]} />);

    const inspector = document.querySelector(".inspector") as HTMLElement;
    expect(inspector.getAttribute("data-matchday")).toBe("true");
    expect(screen.getByText(/SUNDAY · MATCHDAY/)).toBeTruthy();
    // 日期与年份仍在（§13 头部结构）。
    expect(screen.getByText("10月18日")).toBeTruthy();
    expect(screen.getByText("2026")).toBeTruthy();
    expect(screen.getByRole("region", { name: "阿森纳 对 曼城" })).toBeTruthy();
  });

  it("当日其余事件仍作为状态语义列出（多语义不互相吞掉）", () => {
    render(
      <InspectorPanel dateKey="2026-10-18" events={[FIXTURE_EVENT, PLAIN]} />,
    );

    // 比赛标题不再作为普通事件重复出现。
    expect(screen.queryByText("Arsenal vs Manchester City")).toBeNull();
    expect(screen.getByText("每周站会")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "事件" })).toBeTruthy();
  });

  it("关注球队在比赛详情里标记（SPORT-006 的可见效果）", () => {
    render(
      <InspectorPanel
        dateKey="2026-10-18"
        events={[FIXTURE_EVENT]}
        followedTeamIds={["arsenal"]}
      />,
    );

    expect(screen.getAllByText("关注")).toHaveLength(1);
  });

  it("普通日期不进入比赛模式：结构与留白不变（§12）", () => {
    render(<InspectorPanel dateKey="2026-10-18" events={[PLAIN]} />);

    const inspector = document.querySelector(".inspector") as HTMLElement;
    expect(inspector.hasAttribute("data-matchday")).toBe(false);
    expect(inspector.className).toBe("inspector");
    expect(screen.getByText("SUNDAY")).toBeTruthy();
    expect(screen.queryByText(/MATCHDAY/)).toBeNull();
  });
});
