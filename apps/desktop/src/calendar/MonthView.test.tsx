import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { buildMonthGrid } from "./month-grid";
import { MonthView } from "./MonthView";
import type { EnrichedEvent } from "../data/model";

afterEach(cleanup);

/**
 * SC-009：月格对语义增强的通用消费。
 * 组件只读 Metadata Resolver 输出的 accent 与 semantic.type，
 * 自身不含任何球队 / 节日标题判断（验收：UI 不包含领域判断）。
 */

const HOLIDAY: EnrichedEvent = {
  uid: "holiday-1",
  sourceId: "src-1",
  title: "国庆假期",
  normalizedTitle: "国庆假期",
  start: "2026-10-01",
  allDay: true,
  semantic: { type: "holiday", matcherId: "test-matcher" },
  metadata: {
    accent: "var(--semantic-holiday)",
    label: "法定节假日",
    reminder: { kind: "same-morning" },
  },
};

const PLAIN: EnrichedEvent = {
  uid: "plain-1",
  sourceId: "src-1",
  title: "每周站会",
  normalizedTitle: "每周站会",
  start: "2026-10-01T09:00:00",
  allDay: false,
};

function renderOctober(eventsByDate: Map<string, EnrichedEvent[]>) {
  const grid = buildMonthGrid({ year: 2026, month: 10, today: "2026-10-01" });
  render(
    <MonthView
      grid={grid}
      selectedDateKey="2026-10-01"
      onSelectDate={() => {}}
      onStepMonth={() => {}}
      onGoToToday={() => {}}
      onStepSelection={() => {}}
      eventsByDate={eventsByDate}
    />,
  );
  return screen.getByRole("grid", { name: "2026年10月" });
}

describe("月格事件摘要的语义增强显示（SC-009）", () => {
  it("增强事件带语义 accent 与类型标记，值全部来自元数据", () => {
    const grid = renderOctober(new Map([["2026-10-01", [HOLIDAY, PLAIN]]]));

    const chip = grid.querySelector(
      '[data-semantic-type="holiday"]',
    ) as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.className).toContain("is-semantic");
    expect(chip.style.getPropertyValue("--event-accent")).toBe(
      "var(--semantic-holiday)",
    );
  });

  it("未匹配事件按普通样式显示：无语义标记、无 accent（SEM-003）", () => {
    const grid = renderOctober(new Map([["2026-10-01", [HOLIDAY, PLAIN]]]));

    const plain = grid.querySelector('[data-date="2026-10-01"]')!;
    const plainChip = plain.querySelector('[title="每周站会"]');
    expect(plainChip?.className).toBe("cell-event");
    expect(plainChip?.hasAttribute("data-semantic-type")).toBe(false);
    expect(plainChip?.hasAttribute("style")).toBe(false);
    // 普通事件标题照常渲染，不会因为未匹配而消失。
    expect(plain.textContent).toContain("09:00 每周站会");
  });

  it("畸形元数据不破坏渲染：字段被丢弃，事件按普通样式显示", () => {
    const corrupted: EnrichedEvent = {
      ...PLAIN,
      uid: "corrupt-1",
      semantic: { type: "festival", matcherId: "m" },
      metadata: { accent: 123, label: "传统节日" },
    };
    const grid = renderOctober(new Map([["2026-10-01", [corrupted]]]));

    const chip = grid
      .querySelector('[data-date="2026-10-01"]')!
      .querySelector('[title="每周站会"]');
    // accent 非法被丢弃 → 不注入 style；类型标记仍来自 semantic 本身。
    expect(chip?.hasAttribute("style")).toBe(false);
    expect(chip?.getAttribute("data-semantic-type")).toBe("festival");
  });
});
