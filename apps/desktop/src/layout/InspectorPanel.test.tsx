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

/**
 * SC-010：详情栏农历行（ui-design §12「10月14日 / 2026 / 农历九月初五」）。
 * 文本由应用层注入，组件不换算；范围外（无载荷）时整行不出现。
 */
describe("详情栏农历行（SC-010 / CN-001）", () => {
  it("显示农历完整写法，位于公历日期与年份之后（§12 次序）", () => {
    render(
      <InspectorPanel
        dateKey="2026-10-18"
        events={[]}
        lunar={{ cell: "初九", detail: "农历九月初九" }}
      />,
    );

    const lunar = screen.getByText("农历九月初九");
    expect(lunar.className).toBe("inspector-lunar");
    expect(lunar.previousElementSibling?.textContent).toBe("2026");
    expect(
      lunar.previousElementSibling?.previousElementSibling?.textContent,
    ).toBe("10月18日");
  });

  it("无农历载荷时不显示该行（范围外不猜）", () => {
    render(<InspectorPanel dateKey="2026-10-18" events={[PLAIN]} />);

    expect(document.querySelector(".inspector-lunar")).toBeNull();
    // 其余日期详情不受影响。
    expect(screen.getByText("10月18日")).toBeTruthy();
    expect(screen.getByText("2026")).toBeTruthy();
  });
});

/**
 * SC-011：详情栏休假 / 补班行（ui-design §11.1 状态类型「节假日」）。
 * 大字、假期名与连休位置都由应用层载荷注入，组件不判断日期；
 * 月格的休假视觉（连续背景、裁切大字）属 SC-013，这里只验证文字层。
 */
describe("详情栏休假 / 补班行（SC-011 / CN-002–004）", () => {
  it("放假日显示大字、假期名与连休位置", () => {
    render(
      <InspectorPanel
        dateKey="2026-10-03"
        events={[]}
        lunar={{ cell: "廿二", detail: "农历八月廿二" }}
        chinaDay={{
          kind: "rest",
          glyph: "休",
          accent: "var(--semantic-holiday)",
          label: "国庆节假期",
          position: "第 3 天 / 共 7 天",
          run: { id: "2026-10-01", index: 2, length: 7 },
        }}
      />,
    );

    const row = document.querySelector(".inspector-china-day") as HTMLElement;
    expect(row.getAttribute("data-china-day")).toBe("rest");
    // 语义色来自载荷注入的 CSS 变量（UI 不接触具体色值）。
    expect(row.style.getPropertyValue("--china-day-accent")).toBe(
      "var(--semantic-holiday)",
    );
    expect(within(row).getByText("休")).toBeTruthy();
    expect(within(row).getByText("国庆节假期")).toBeTruthy();
    expect(within(row).getByText("第 3 天 / 共 7 天")).toBeTruthy();
    // 位于农历行之后：日期 → 农历 → 休 / 补。
    expect(row.previousElementSibling?.className).toBe("inspector-lunar");
  });

  it("补班日与休假是不同的语义标记，且不写连休位置", () => {
    render(
      <InspectorPanel
        dateKey="2026-10-10"
        events={[]}
        chinaDay={{
          kind: "makeup",
          glyph: "补",
          accent: "var(--semantic-makeup-workday)",
          label: "国庆节补班日",
        }}
      />,
    );

    const row = document.querySelector(".inspector-china-day") as HTMLElement;
    expect(row.getAttribute("data-china-day")).toBe("makeup");
    expect(row.style.getPropertyValue("--china-day-accent")).toBe(
      "var(--semantic-makeup-workday)",
    );
    expect(within(row).getByText("补")).toBeTruthy();
    expect(within(row).getByText("国庆节补班日")).toBeTruthy();
    expect(within(row).queryByText(/共 \d+ 天/)).toBeNull();
  });

  it("不是假期时不显示该行（不猜假期）", () => {
    render(<InspectorPanel dateKey="2026-10-18" events={[PLAIN]} />);

    expect(document.querySelector(".inspector-china-day")).toBeNull();
    expect(screen.getByText("10月18日")).toBeTruthy();
  });
});

/**
 * SC-012：详情栏的传统节日 / 节气块（CN-005–006 / ui-design §9.2、§11.1）。
 * 语义类型、名称、英文名、序号与释义全部来自注入载荷，
 * 组件只负责排版与「哪一条是主语义」（载荷顺序，§16.1）。
 */
describe("详情栏节日 / 节气块（SC-012 / CN-005–006）", () => {
  const COLD_DEW = {
    kind: "solar-term" as const,
    id: "cold-dew",
    name: "寒露",
    nameEn: "Cold Dew",
    gloss: "露气寒冷，将凝结也。",
    note: "第 19 个节气",
    accent: "var(--semantic-solar-term)",
    backgroundRef: "bg.solar-term.cold-dew",
  };
  const MID_AUTUMN = {
    kind: "festival" as const,
    id: "mid-autumn-festival",
    name: "中秋节",
    nameEn: "Mid-Autumn Festival",
    gloss: "八月十五，赏月团圆，食月饼。",
    accent: "var(--semantic-festival)",
    backgroundRef: "bg.festival.mid-autumn-festival",
  };

  it("节气块：星期行带 SOLAR TERM，块内是名称、英文名、序号与一句释义", () => {
    render(
      <InspectorPanel
        dateKey="2026-10-08"
        events={[]}
        lunar={{ cell: "十六", detail: "农历八月十六" }}
        chinaSemantic={{ entries: [COLD_DEW] }}
      />,
    );

    expect(screen.getByText("THURSDAY · SOLAR TERM")).toBeTruthy();
    const block = document.querySelector(
      ".inspector-day-semantic",
    ) as HTMLElement;
    expect(block.getAttribute("data-china-semantic")).toBe("solar-term");
    expect(block.getAttribute("data-china-backdrop")).toBe(
      "bg.solar-term.cold-dew",
    );
    expect(block.style.getPropertyValue("--day-accent")).toBe(
      "var(--semantic-solar-term)",
    );
    expect(within(block).getByText("寒露")).toBeTruthy();
    expect(within(block).getByText("Cold Dew")).toBeTruthy();
    expect(within(block).getByText("第 19 个节气")).toBeTruthy();
    expect(within(block).getByText("露气寒冷，将凝结也。")).toBeTruthy();
    // 农历行与语义块并存（§9.2 的详情栏同时给农历与节气）。
    expect(screen.getByText("农历八月十六")).toBeTruthy();
  });

  it("节日块：星期行带 FESTIVAL，没有序号行", () => {
    render(
      <InspectorPanel
        dateKey="2026-09-25"
        events={[]}
        chinaSemantic={{ entries: [MID_AUTUMN] }}
      />,
    );

    expect(screen.getByText("FRIDAY · FESTIVAL")).toBeTruthy();
    const block = document.querySelector(
      ".inspector-day-semantic",
    ) as HTMLElement;
    expect(within(block).getByText("中秋节")).toBeTruthy();
    expect(within(block).queryByText(/个节气/)).toBeNull();
    expect(block.querySelector(".inspector-day-semantic-note")).toBeNull();
  });

  it("同日两条语义时逐条列出，星期行用第一条（§16.1 主背景优先级）", () => {
    const qingmingTerm = {
      ...COLD_DEW,
      id: "pure-brightness",
      name: "清明",
      nameEn: "Pure Brightness",
      note: "第 7 个节气",
      backgroundRef: "bg.solar-term.pure-brightness",
    };
    render(
      <InspectorPanel
        dateKey="2026-04-05"
        events={[]}
        chinaSemantic={{
          entries: [
            {
              ...MID_AUTUMN,
              id: "qingming-festival",
              name: "清明节",
              nameEn: "Qingming Festival",
              gloss: "扫墓祭祖，踏青郊游。",
              backgroundRef: "bg.festival.qingming-festival",
            },
            qingmingTerm,
          ],
        }}
      />,
    );

    expect(screen.getByText("SUNDAY · FESTIVAL")).toBeTruthy();
    const kinds = [...document.querySelectorAll(".inspector-day-semantic")].map(
      (block) => block.getAttribute("data-china-semantic"),
    );
    expect(kinds).toEqual(["festival", "solar-term"]);
    expect(screen.getByText("清明节")).toBeTruthy();
    expect(screen.getByText("清明")).toBeTruthy();
  });

  it("比赛日与节气同日时两个标签都在，语义块排在比赛详情之前（§16）", () => {
    const fixtureEvent: EnrichedEvent = {
      ...MATCH,
      metadata: {
        ...MATCH.metadata,
        fixture: {
          competition: {
            id: "premier-league",
            label: "英超",
            nameZh: "英格兰足球超级联赛",
            nameEn: "Premier League",
            colors: { primary: "#37003C", secondary: "#00FF87" },
          },
          teams: [
            {
              id: "arsenal",
              nameZh: "阿森纳",
              nameEn: "Arsenal",
              code: "ARS",
              colors: { primary: "#EF0107", secondary: "#FFFFFF" },
            },
            {
              id: "manchester-city",
              nameZh: "曼城",
              nameEn: "Manchester City",
              code: "MCI",
              colors: { primary: "#6CABDD", secondary: "#1C2C5B" },
            },
          ],
        },
      },
    };
    render(
      <InspectorPanel
        dateKey="2026-10-08"
        events={[fixtureEvent]}
        chinaSemantic={{ entries: [COLD_DEW] }}
      />,
    );

    expect(document.querySelector(".inspector-weekday")?.textContent).toBe(
      "THURSDAY · SOLAR TERM · MATCHDAY",
    );
    // 语义块（§16.1 主背景语义）在比赛详情之前，两条状态语义都保留。
    const semantics = document.querySelector(".inspector-day-semantics");
    const matchday = document.querySelector(".matchday");
    if (semantics === null || matchday === null) {
      throw new Error("语义块与比赛详情都应渲染");
    }
    expect(
      semantics.compareDocumentPosition(matchday) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("普通日期不显示语义块，星期行也没有多余标签", () => {
    render(<InspectorPanel dateKey="2026-10-14" events={[PLAIN]} />);

    expect(document.querySelector(".inspector-day-semantics")).toBeNull();
    expect(document.querySelector(".inspector-weekday")?.textContent).toBe(
      "WEDNESDAY",
    );
  });
});
