import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { buildMonthGrid } from "./month-grid";
import { MonthView } from "./MonthView";
import type { EnrichedEvent } from "../data/model";
import type { FixtureDisplay } from "../semantic/metadata-resolver";

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

/** SC-016：比赛事件的完整对阵载荷（形状与 Resolver 输出一致）。 */
/** SC-016：比赛事件的完整对阵载荷（形状与 Resolver 输出一致）。 */
const FIXTURE_DISPLAY: FixtureDisplay = {
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
};

const FIXTURE: EnrichedEvent = {
  uid: "match-1",
  sourceId: "src-1",
  title: "Arsenal vs Manchester City",
  normalizedTitle: "Arsenal vs Manchester City",
  start: "2026-10-01T23:30:00",
  allDay: false,
  semantic: {
    type: "sport.fixture",
    subtype: "premier-league",
    matcherId: "football.fixture-title",
  },
  metadata: {
    accent: "var(--semantic-sport)",
    label: "英超",
    reminder: { kind: "minutes-before-start", minutes: 30 },
    fixture: FIXTURE_DISPLAY,
  },
};

/** 同一天的第二 / 第三场比赛，用于验证单格上限。 */
function extraFixture(uid: string, home: string, away: string): EnrichedEvent {
  const team = (id: string) =>
    FIXTURE_DISPLAY.teams.find((entry) => entry.id === id) ?? {
      ...FIXTURE_DISPLAY.teams[0],
      id,
    };
  return {
    ...FIXTURE,
    uid,
    metadata: {
      ...FIXTURE.metadata,
      fixture: { ...FIXTURE_DISPLAY, teams: [team(home), team(away)] },
    },
  };
}

function cellOf(grid: HTMLElement, dateKey: string): HTMLElement {
  return grid.querySelector(`[data-date="${dateKey}"]`) as HTMLElement;
}

describe("比赛月格（SC-016 / SPORT-004 / ui-design §10）", () => {
  it("格内只显示队标 VS 队标：队名、开赛时间都不进格子", () => {
    const grid = renderOctober(new Map([["2026-10-01", [FIXTURE]]]));
    const cell = cellOf(grid, "2026-10-01");

    const marks = cell.querySelectorAll(".match-cell .mark.is-fallback");
    expect([...marks].map((mark) => mark.textContent)).toEqual(["ARS", "MCI"]);
    expect(cell.querySelector(".match-cell-vs")?.textContent).toBe("VS");
    // 标题、队名、开赛时间都属于 Inspector（§10.2）。
    expect(cell.textContent).not.toContain("Arsenal");
    expect(cell.textContent).not.toContain("阿森纳");
    expect(cell.textContent).not.toContain("23:30");
  });

  it("整块比赛区域给出对阵与开赛时间的 hover / 读屏描述（§18.1）", () => {
    const grid = renderOctober(new Map([["2026-10-01", [FIXTURE]]]));
    const block = cellOf(grid, "2026-10-01").querySelector(
      ".match-cell-teams",
    ) as HTMLElement;

    expect(block.getAttribute("role")).toBe("img");
    expect(block.getAttribute("aria-label")).toBe("阿森纳 vs 曼城 · 23:30");
    // 两侧队徽是装饰：文字与读屏由整块描述承担，hover 仍可看队名。
    const marks = [...block.querySelectorAll(".mark")];
    expect(marks.map((mark) => mark.getAttribute("aria-hidden"))).toEqual([
      "true",
      "true",
    ]);
    expect(marks.map((mark) => mark.getAttribute("title"))).toEqual([
      "阿森纳",
      "曼城",
    ]);
  });

  it("联赛背景是日期格的直接子元素（由格子裁切，不溢出到相邻格）", () => {
    const grid = renderOctober(new Map([["2026-10-01", [FIXTURE]]]));
    const cell = cellOf(grid, "2026-10-01");
    const background = cell.querySelector(".match-cell-bg") as HTMLElement;

    expect(background.parentElement).toBe(cell);
    // 资源包缺失时背景用联赛短标签，仍然是可渲染的降级视觉。
    expect(background.textContent).toBe("英超");
  });

  it("一天多场比赛：单格最多两场，其余折叠为计数", () => {
    const grid = renderOctober(
      new Map([
        [
          "2026-10-01",
          [
            FIXTURE,
            extraFixture("match-2", "manchester-city", "arsenal"),
            extraFixture("match-3", "arsenal", "manchester-city"),
          ],
        ],
      ]),
    );
    const cell = cellOf(grid, "2026-10-01");

    expect(cell.querySelectorAll(".match-cell")).toHaveLength(2);
    expect(cell.querySelector(".cell-event-more")?.textContent).toBe(
      "还有 1 场比赛",
    );
    // 背景每格只画一次，不随场次叠加。
    expect(cell.querySelectorAll(".match-cell-bg")).toHaveLength(1);
  });

  it("比赛与普通事件同日：普通事件仍按摘要显示（多语义不互相吞掉）", () => {
    const grid = renderOctober(new Map([["2026-10-01", [FIXTURE, PLAIN]]]));
    const cell = cellOf(grid, "2026-10-01");

    expect(cell.querySelectorAll(".match-cell")).toHaveLength(1);
    expect(cell.textContent).toContain("09:00 每周站会");
  });

  it("有比赛时普通摘要减少展示数，保证计数行留在格内（格子裁切）", () => {
    const meetings = Array.from({ length: 4 }, (_, index) => ({
      ...PLAIN,
      uid: `plain-${index}`,
      title: `站会 ${index}`,
    }));
    const grid = renderOctober(
      new Map([["2026-10-01", [FIXTURE, ...meetings]]]),
    );
    const cell = cellOf(grid, "2026-10-01");

    expect(cell.querySelectorAll(".match-cell")).toHaveLength(1);
    expect(cell.querySelectorAll(".cell-event")).toHaveLength(2);
    expect(cell.querySelector(".cell-event-more")?.textContent).toBe(
      "还有 2 项",
    );
  });

  it("对阵载荷残缺时按普通事件显示：不渲染半张比赛卡（SEM-003）", () => {
    const broken: EnrichedEvent = {
      ...FIXTURE,
      metadata: {
        accent: "var(--semantic-sport)",
        label: "英超",
        fixture: { ...FIXTURE_DISPLAY, teams: [FIXTURE_DISPLAY.teams[0]] },
      },
    };
    const grid = renderOctober(new Map([["2026-10-01", [broken]]]));
    const cell = cellOf(grid, "2026-10-01");

    expect(cell.querySelector(".match-cell")).toBeNull();
    expect(cell.querySelector(".match-cell-bg")).toBeNull();
    expect(cell.textContent).toContain("Arsenal vs Manchester City");
  });

  it("资源包提供图片时渲染 img，缺失时降级为代码（§22 固定容器）", () => {
    const grid = buildMonthGrid({
      year: 2026,
      month: 10,
      today: "2026-10-01",
    });
    render(
      <MonthView
        grid={grid}
        selectedDateKey="2026-10-01"
        onSelectDate={() => {}}
        onStepMonth={() => {}}
        onGoToToday={() => {}}
        onStepSelection={() => {}}
        eventsByDate={new Map([["2026-10-01", [FIXTURE]]])}
        assets={{ urlFor: (ref) => `/assets/${ref}.svg` }}
      />,
    );

    const cell = cellOf(
      screen.getByRole("grid", { name: "2026年10月" }),
      "2026-10-01",
    );
    // 两侧队徽与联赛背景都解析为图片；默认资源包（上面的用例）则全部降级为文字。
    expect(cell.querySelectorAll(".match-cell .mark.is-asset")).toHaveLength(2);
    expect(cell.querySelectorAll(".match-cell .mark.is-fallback")).toHaveLength(
      0,
    );
    expect(
      (cell.querySelector(".match-cell-bg-image") as HTMLImageElement).src,
    ).toContain("/assets/logo.competition.premier-league.svg");
  });
});

/**
 * SC-010：月格农历简写（CN-001 / ui-design §5.2）。
 * 组件只渲染注入的展示载荷（日期键 → 文本），不自己做换算；
 * 载荷缺省的日期安静地少一行，不影响日期数字与事件摘要。
 */
describe("月格农历简写（SC-010 / CN-001）", () => {
  const LUNAR = new Map([
    ["2026-10-01", { cell: "八月", detail: "农历八月初一" }],
    ["2026-10-10", { cell: "九月", detail: "农历九月初一" }],
    ["2026-10-18", { cell: "初九", detail: "农历九月初九" }],
  ]);

  function renderWithLunar() {
    const grid = buildMonthGrid({ year: 2026, month: 10, today: "2026-10-01" });
    render(
      <MonthView
        grid={grid}
        selectedDateKey="2026-10-01"
        onSelectDate={() => {}}
        onStepMonth={() => {}}
        onGoToToday={() => {}}
        onStepSelection={() => {}}
        eventsByDate={new Map()}
        lunarByDate={LUNAR}
      />,
    );
    return screen.getByRole("grid", { name: "2026年10月" });
  }

  it("农历文本按日期键落在对应格子，日期数字保持独立元素", () => {
    const grid = renderWithLunar();
    const cell = cellOf(grid, "2026-10-18");

    const lunar = cell.querySelector(".cell-lunar");
    expect(lunar?.textContent).toBe("初九");
    // 农历行是日期数字之后的兄弟节点：不覆盖、也不挤进数字本身。
    const day = cell.querySelector(".cell-day");
    expect(day?.textContent).toBe("18");
    expect(day?.nextElementSibling).toBe(lunar);
  });

  it("初一是农历月份边界，写月名；跨月格同样显示", () => {
    const grid = renderWithLunar();

    expect(
      cellOf(grid, "2026-10-10").querySelector(".cell-lunar")?.textContent,
    ).toBe("九月");
    expect(cellOf(grid, "2026-09-28").querySelector(".cell-lunar")).toBeNull();
  });

  it("载荷缺省时不渲染农历行：日期与事件摘要照常", () => {
    const grid = buildMonthGrid({ year: 2026, month: 10 });
    render(
      <MonthView
        grid={grid}
        selectedDateKey="2026-10-01"
        onSelectDate={() => {}}
        onStepMonth={() => {}}
        onGoToToday={() => {}}
        onStepSelection={() => {}}
        eventsByDate={new Map([["2026-10-01", [PLAIN]]])}
      />,
    );

    const cell = cellOf(
      screen.getByRole("grid", { name: "2026年10月" }),
      "2026-10-01",
    );
    expect(cell.querySelector(".cell-lunar")).toBeNull();
    expect(cell.querySelector(".cell-day")?.textContent).toBe("1");
    expect(cell.textContent).toContain("每周站会");
  });
});

/**
 * SC-011：月格的休假 / 补班挂钩（CN-004 / ui-design §7.1）。
 * 组件只把注入的载荷挂成 data 属性：类别（休 / 补）与连休区段 id。
 * 连续背景与裁切的大字属 SC-013，这里验证「连续区段在 DOM 里可识别」。
 */
describe("月格休假 / 补班挂钩（SC-011 / CN-002–004）", () => {
  const CHINA_DAYS = new Map([
    [
      "2026-10-01",
      {
        kind: "rest" as const,
        glyph: "休",
        accent: "var(--semantic-holiday)",
        label: "国庆节假期",
        position: "第 1 天 / 共 7 天",
        run: { id: "2026-10-01", index: 0, length: 7 },
      },
    ],
    [
      "2026-10-03",
      {
        kind: "rest" as const,
        glyph: "休",
        accent: "var(--semantic-holiday)",
        label: "国庆节假期",
        position: "第 3 天 / 共 7 天",
        run: { id: "2026-10-01", index: 2, length: 7 },
      },
    ],
    [
      "2026-10-10",
      {
        kind: "makeup" as const,
        glyph: "补",
        accent: "var(--semantic-makeup-workday)",
        label: "国庆节补班日",
      },
    ],
  ]);

  function renderWithChinaDays() {
    const grid = buildMonthGrid({ year: 2026, month: 10, today: "2026-10-01" });
    render(
      <MonthView
        grid={grid}
        selectedDateKey="2026-10-01"
        onSelectDate={() => {}}
        onStepMonth={() => {}}
        onGoToToday={() => {}}
        onStepSelection={() => {}}
        eventsByDate={new Map()}
        chinaDayByDate={CHINA_DAYS}
      />,
    );
    return screen.getByRole("grid", { name: "2026年10月" });
  }

  it("放假日挂上类别与连休区段 id，相邻格共享同一个 id", () => {
    const grid = renderWithChinaDays();

    expect(cellOf(grid, "2026-10-01").getAttribute("data-china-day")).toBe(
      "rest",
    );
    expect(cellOf(grid, "2026-10-01").getAttribute("data-china-run")).toBe(
      "2026-10-01",
    );
    expect(cellOf(grid, "2026-10-03").getAttribute("data-china-run")).toBe(
      "2026-10-01",
    );
    expect(cellOf(grid, "2026-10-03").getAttribute("data-china-day")).toBe(
      "rest",
    );
  });

  it("补班日与休假是不同的类别标记，且不带连休区段", () => {
    const grid = renderWithChinaDays();
    const cell = cellOf(grid, "2026-10-10");

    expect(cell.getAttribute("data-china-day")).toBe("makeup");
    expect(cell.hasAttribute("data-china-run")).toBe(false);
  });

  it("普通日期不挂休假 / 补班标记（不猜假期）", () => {
    const grid = renderWithChinaDays();
    const cell = cellOf(grid, "2026-10-02");

    expect(cell.hasAttribute("data-china-day")).toBe(false);
    expect(cell.hasAttribute("data-china-run")).toBe(false);
    // 日期数字与普通结构不受影响。
    expect(cell.querySelector(".cell-day")?.textContent).toBe("2");
  });
});
