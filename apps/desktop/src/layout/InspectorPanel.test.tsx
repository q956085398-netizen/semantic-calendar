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
