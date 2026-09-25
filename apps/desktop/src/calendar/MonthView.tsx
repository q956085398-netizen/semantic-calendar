import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { eventKey, identityOfEvent, type EnrichedEvent } from "../data/model";
import { WEEKDAY_LABELS, type MonthGrid } from "./month-grid";
import {
  eventTimeLabel,
  splitFixtureEvents,
  type FixtureEvent,
} from "./event-display";
import { MatchCell } from "./MatchCell";
import { cellBackdropOf, type CellBackdrop } from "./cell-backdrop";
import { CompetitionBackdrop } from "../display/CompetitionBackdrop";
import { DayBackdrop } from "../display/DayBackdrop";
import { displayMetadataOf } from "../semantic/metadata-resolver";
import type { MarkAssetSource } from "../semantic/marks";
import type { LunarLabel } from "../semantic/app-lunar";
import type { ChinaDayLabel } from "../semantic/app-china-days";
import type { ChinaDaySemanticLabel } from "../semantic/app-china-festivals";

/**
 * 月视图（CAL-001 / CAL-002）：6×7 网格、月份导航、日期选择。
 *
 * - 顶部导航次序遵循 ui-design §5.1：上一月 · 年月 · 下一月 · 今天（次级按钮）；
 * - 选择遵循 WAI-ARIA grid 模式：roving tabindex，选中格 aria-selected；
 * - 方向键 ±1 / ±7 天移动选择，跨出当前月时由 App 联动切换视图；
 * - 键盘 / 点击选择后焦点落在新的选中格，跨月导航后焦点不丢失；
 * - 事件摘要按日期键注入（SC-006），只做排版不做业务判断；
 * - 比赛事件渲染为“队标 VS 队标”（SC-016 / §10.2），其余事件按普通摘要渲染；
 * - 农历简写（SC-010 / §5.2）与事件摘要一样按日期键注入，只排版不换算；
 * - 休假 / 补班（SC-011）按日期键注入，格子据此挂上类别与连休区段 id；
 * - 传统节日与节气（SC-012）按 ui-design 参考图分两处：节日名占农历那一行
 *   （特殊日期的语义内容取代农历简写），节气名做右上角小标签；
 * - 主背景（SC-013 / §16.1）由 cellBackdropOf 裁决，一个格子只有一个——
 *   节日 / 节气专属视觉（DayBackdrop，图片被格子裁切、文字区带遮罩）＞
 *   联赛视觉 ＞ 假期 / 补班（底色 + 大「休」「补」）＞ 普通背景；
 *   主背景之外还剩两种不参与竞争的叠加：比赛的对阵块与事件摘要，
 *   它们与任意主背景共存（队标 VS 队标在 §16.1 里属于状态语义）；
 * - v0.1 只提供月视图，周 / 日入口保留占位但不激活。
 */

/** 方向键 → 天数步进（上下为整周）。 */
const ARROW_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

/** 单格最多直接展示的事件数，其余折叠为计数（ui-design §6 必要摘要）。 */
const MAX_CELL_EVENTS = 3;

/** 有比赛时单格高度已被比赛块占用，普通摘要相应减少（格子裁切，溢出即丢信息）。 */
const MAX_CELL_EVENTS_WITH_FIXTURES = 2;

/** 单格最多展示的比赛场数，其余折叠为计数（一天多场时格子仍保持简洁）。 */
const MAX_CELL_FIXTURES = 2;

/**
 * 语义色 token → 格内 CSS 变量；载荷缺色时返回 undefined，
 * 样式回落到主题前景色（不在 UI 里猜一个颜色）。
 * 两个变量分工不同：--day-accent 给格内的语义文字，--cell-accent 给
 * 休假 / 补班的底色与大字（它们作用在格子本身与其背景层上）。
 */
function accentStyle(
  name: "--day-accent" | "--cell-accent",
  accent: string | undefined,
): CSSProperties | undefined {
  return accent === undefined
    ? undefined
    : ({ [name]: accent } as CSSProperties);
}

interface MonthViewProps {
  grid: MonthGrid;
  selectedDateKey: string;
  onSelectDate: (dateKey: string) => void;
  /** 月份步进：-1 上一月，+1 下一月。 */
  onStepMonth: (delta: number) => void;
  onGoToToday: () => void;
  /** 按天移动当前选择（键盘导航）。 */
  onStepSelection: (days: number) => void;
  /** 按日期键分桶的事件（SC-006 导入结果）。只读：组件不写这份数据。 */
  eventsByDate: ReadonlyMap<string, EnrichedEvent[]>;
  /** 按日期键分桶的农历简写（SC-010；范围外的日期缺省，不显示该行）。 */
  lunarByDate?: Map<string, LunarLabel>;
  /** 按日期键分桶的休假 / 补班载荷（SC-011；非假期与未登记年份缺省）。 */
  chinaDayByDate?: Map<string, ChinaDayLabel>;
  /** 按日期键分桶的传统节日 / 节气载荷（SC-012；普通日期缺省）。 */
  chinaSemanticByDate?: Map<string, ChinaDaySemanticLabel>;
  /**
   * 队徽 / 联赛 Logo 与节日 / 节气专属背景的资源包（默认不携带图片，SC-022 口径）。
   * 两种背景各有一套缺省语义（标记有文字 fallback，背景没有），但资源包接口
   * 恰好同形（urlFor），因此一个 prop 同时交给两者，不需要在装配处拆成两份。
   */
  assets?: MarkAssetSource;
  /**
   * 表头状态行（SC-020）：整理事件期间说明“为什么月格暂时没有事件”。
   * 文案由调用方给出——业务判断不进 UI，可解释状态的说法也只有一个来源
   * （§13）。
   */
  status?: string;
}

export function MonthView({
  grid,
  selectedDateKey,
  onSelectDate,
  onStepMonth,
  onGoToToday,
  onStepSelection,
  eventsByDate,
  lunarByDate,
  chinaDayByDate,
  chinaSemanticByDate,
  assets,
  status,
}: MonthViewProps) {
  const title = `${grid.year}年${grid.month}月`;
  // roving tabindex 的落点：优先选中格。纯月份导航不移动选择，选中格可能
  // 不在当前网格内；此时退化到今天格、再退化到当月首格，保证网格始终
  // 存在一个可聚焦格，键盘用户不会丢失进入入口（app-spec §16 / §24）。
  const tabbableDateKey = useMemo(() => {
    const cells = grid.weeks.flat();
    if (cells.some((cell) => cell.dateKey === selectedDateKey)) {
      return selectedDateKey;
    }
    return (
      cells.find((cell) => cell.isToday)?.dateKey ??
      cells.find((cell) => cell.inMonth)?.dateKey ??
      cells[0].dateKey
    );
  }, [grid, selectedDateKey]);
  const gridRef = useRef<HTMLDivElement | null>(null);
  // 选择更新后把焦点移到新的选中格；仅由本组件内的交互置位。
  const focusSelectionRef = useRef(false);

  useEffect(() => {
    if (!focusSelectionRef.current) return;
    focusSelectionRef.current = false;
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-date="${selectedDateKey}"]`)
      ?.focus();
  }, [selectedDateKey]);

  function selectDate(dateKey: string) {
    focusSelectionRef.current = true;
    onSelectDate(dateKey);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = ARROW_STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    focusSelectionRef.current = true;
    onStepSelection(step);
  }

  return (
    <section className="month-view" aria-label={title}>
      <header className="month-header">
        <div className="month-nav">
          <button
            type="button"
            className="month-nav-button"
            aria-label="上一月"
            onClick={() => onStepMonth(-1)}
          >
            ‹
          </button>
          <h2 className="month-title">{title}</h2>
          <button
            type="button"
            className="month-nav-button"
            aria-label="下一月"
            onClick={() => onStepMonth(1)}
          >
            ›
          </button>
          <button type="button" className="today-button" onClick={onGoToToday}>
            今天
          </button>
          {/* 状态行与导航同一行：不新增表头高度，最小窗口下网格不会因此少一行。 */}
          {status !== undefined && (
            <p className="month-status" role="status">
              {status}
            </p>
          )}
        </div>
        <div className="segmented" role="group" aria-label="视图切换">
          <button type="button" className="segmented-item" aria-pressed="true">
            月
          </button>
          <button
            type="button"
            className="segmented-item"
            disabled
            title="v0.1 仅提供月视图"
          >
            周
          </button>
          <button
            type="button"
            className="segmented-item"
            disabled
            title="v0.1 仅提供月视图"
          >
            日
          </button>
        </div>
      </header>

      <div className="month-grid" role="grid" aria-label={title} ref={gridRef}>
        <div className="month-weekdays" role="row">
          {WEEKDAY_LABELS.map((label, index) => (
            <div
              key={label}
              role="columnheader"
              // 周末列弱化为次要色，与工作日区分（不依赖颜色单独表达信息）。
              className={`weekday${index >= 5 ? " is-weekend" : ""}`}
            >
              {label}
            </div>
          ))}
        </div>
        {grid.weeks.map((week, weekIndex) => (
          <div className="month-week" role="row" key={weekIndex}>
            {week.map((cell) => {
              const isSelected = cell.dateKey === selectedDateKey;
              const lunar = lunarByDate?.get(cell.dateKey);
              const chinaDay = chinaDayByDate?.get(cell.dateKey);
              const semantic = chinaSemanticByDate?.get(cell.dateKey);
              // 节日名占农历那一行，节气名进角落标签（ui-design 参考图的
              // 两处位置）。类别是封闭的两值联合：没有落位规则的类别不会
              // 被静默塞进某一行——将来新增语义时，这里是必须改的一处。
              const festival = semantic?.entries.find(
                (entry) => entry.kind === "festival",
              );
              const solarTerm = semantic?.entries.find(
                (entry) => entry.kind === "solar-term",
              );
              const { fixtures, ordinary } = splitFixtureEvents(
                eventsByDate.get(cell.dateKey) ?? [],
              );
              // 主背景只有一个（SC-013 / §16.1）：节日 / 节气 ＞ 联赛 ＞
              // 假期 / 补班 ＞ 普通。假期视觉（底色 + 大字）是其中一项，
              // 让位时整体不画——参考图里 10 月 4 日与 10 月 6 日都如此。
              const backdrop = cellBackdropOf({
                chinaSemantic: semantic,
                fixtures,
                chinaDay,
              });
              // 假期底色的语义色（§20）只在假期成为主背景时注入；
              // 让位的日子格子上不留一个没人消费的变量。
              const cellAccent =
                backdrop.kind === "holiday" ? chinaDay?.accent : undefined;
              return (
                <div
                  key={cell.dateKey}
                  role="gridcell"
                  data-date={cell.dateKey}
                  data-outside={cell.inMonth ? undefined : "true"}
                  data-today={cell.isToday ? "true" : undefined}
                  // 休假 / 补班标记（SC-011）：类别给样式选语义色与大字，
                  // 区段 id 让相邻格能被识别为同一次连休（CN-004 / §7.1）。
                  data-china-day={chinaDay?.kind}
                  data-china-run={chinaDay?.run?.id}
                  // 节日 / 节气标记（SC-012）：主语义类别与专属背景引用。
                  data-china-semantic={semantic?.entries[0]?.kind}
                  data-china-backdrop={semantic?.entries[0]?.backgroundRef}
                  // 主背景类别（SC-013）：底色与背景层由样式按它取值，
                  // 普通日期不带这个属性（§6 普通日期保持安静）。
                  data-cell-backdrop={
                    backdrop.kind === "none" ? undefined : backdrop.kind
                  }
                  aria-current={cell.isToday ? "date" : undefined}
                  aria-selected={isSelected}
                  tabIndex={cell.dateKey === tabbableDateKey ? 0 : -1}
                  style={accentStyle("--cell-accent", cellAccent)}
                  className={[
                    "month-cell",
                    cell.inMonth ? "" : "is-outside",
                    cell.isToday ? "is-today" : "",
                    isSelected ? "is-selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => selectDate(cell.dateKey)}
                  onKeyDown={handleKeyDown}
                >
                  <CellBackdropLayer backdrop={backdrop} assets={assets} />
                  {solarTerm && (
                    <span
                      className="cell-solar-term"
                      style={accentStyle("--day-accent", solarTerm.accent)}
                    >
                      {solarTerm.name}
                    </span>
                  )}
                  <span className="cell-day">{cell.day}</span>
                  {festival ? (
                    <span
                      className="cell-semantic"
                      style={accentStyle("--day-accent", festival.accent)}
                    >
                      {festival.name}
                    </span>
                  ) : (
                    lunar && <span className="cell-lunar">{lunar.cell}</span>
                  )}
                  {/* 假期主背景的另一半（§7.2 / §8.2）：底色由 --cell-accent 给出，
                      大字在这里。两者都只在假期成为主背景时出现——所以条件跟着
                      主背景走，而不是「有休假就画大字」（见 cell-backdrop.ts）。
                      文字照常读给读屏（与节气名同一条口径），不只是给视觉看的；
                      位置在日期与农历之后，读屏顺序是「日期 → 农历 → 休 / 补」。 */}
                  {backdrop.kind === "holiday" && chinaDay && (
                    <span className="cell-glyph">{chinaDay.glyph}</span>
                  )}
                  <CellContent
                    fixtures={fixtures}
                    ordinary={ordinary}
                    assets={assets}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * 主背景层（SC-013 / §16.1）：一个格子只画一个，由 cellBackdropOf 裁决。
 *
 * 这里是渲染层唯一按主背景分支的地方，而且分支是穷尽的——将来新增一种主背景，
 * TypeScript 会在这里报错，不会被静默漏画。假期 / 普通日期不画额外元素：
 * 假期的视觉是「格子底色 + 大字」，分别由 --cell-accent 与格子里的 .cell-glyph
 * 承担，没有独立图层。
 */
function CellBackdropLayer({
  backdrop,
  assets,
}: {
  backdrop: CellBackdrop;
  assets?: MarkAssetSource;
}) {
  switch (backdrop.kind) {
    case "festival":
    case "solar-term":
      // 节日 / 节气专属视觉：整格图片，由格子的 overflow: hidden 裁切（§9.1）。
      return <DayBackdrop ref={backdrop.ref} assets={assets} />;
    case "league":
      // 联赛视觉（§10.1）：大面积低透明度狮标 / Logo，同样裁在格内。
      return (
        <CompetitionBackdrop
          competition={backdrop.competition}
          className="match-cell-bg"
          assets={assets}
        />
      );
    case "holiday":
    case "none":
      return null;
  }
}

/**
 * 单格内容：比赛事件渲染“队标 VS 队标”（SC-016 / §10.2），
 * 其余事件按摘要渲染（时间前缀 + 标题，超出上限折叠为计数）。
 * 语义增强（SC-009）只消费 Metadata Resolver 的输出：accent、
 * data-semantic-type 与对阵载荷都是通用管道，组件不含任何球队 / 节日判断。
 *
 * 事件在这里已经按展示载荷切分好（splitFixtureEvents）：主背景裁决
 * （SC-013）在格子上层需要同一份对阵载荷，切分只做一次。
 * 联赛背景不在这里画——它是格子的主背景（§16.1 优先级 2），
 * 与节日 / 节气背景互斥，由格子决定画哪一个。
 */
function CellContent({
  fixtures,
  ordinary,
  assets,
}: {
  fixtures: FixtureEvent[];
  ordinary: EnrichedEvent[];
  assets?: MarkAssetSource;
}) {
  const visibleFixtures = fixtures.slice(0, MAX_CELL_FIXTURES);
  const hiddenFixtures = fixtures.length - visibleFixtures.length;
  // 比赛块已经占掉一格里的主要高度，普通摘要相应减少，
  // 让计数行与最后一条摘要都留在格内（格子是裁切的，溢出等于丢信息）。
  const eventBudget =
    visibleFixtures.length > 0
      ? MAX_CELL_EVENTS_WITH_FIXTURES
      : MAX_CELL_EVENTS;
  const visibleEvents = ordinary.slice(0, eventBudget);
  const hiddenEvents = ordinary.length - visibleEvents.length;

  if (fixtures.length === 0 && ordinary.length === 0) {
    return null;
  }

  return (
    <>
      {visibleFixtures.map(({ event, fixture }) => (
        <MatchCell
          key={eventKey(identityOfEvent(event))}
          fixture={fixture}
          event={event}
          assets={assets}
        />
      ))}
      {hiddenFixtures > 0 && (
        <span className="cell-event-more">还有 {hiddenFixtures} 场比赛</span>
      )}
      {(visibleEvents.length > 0 || hiddenEvents > 0) && (
        <div className="cell-events">
          {visibleEvents.map((event) => {
            const time = eventTimeLabel(event);
            const accent = displayMetadataOf(event)?.accent;
            return (
              <span
                key={eventKey(identityOfEvent(event))}
                className={accent ? "cell-event is-semantic" : "cell-event"}
                data-semantic-type={event.semantic?.type}
                style={
                  accent
                    ? ({ "--event-accent": accent } as CSSProperties)
                    : undefined
                }
                title={event.title}
              >
                {time ? `${time} ` : ""}
                {event.title || "（无标题）"}
              </span>
            );
          })}
          {hiddenEvents > 0 && (
            <span className="cell-event-more">还有 {hiddenEvents} 项</span>
          )}
        </div>
      )}
    </>
  );
}
