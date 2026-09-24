import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { eventKey, identityOfEvent, type EnrichedEvent } from "../data/model";
import { WEEKDAY_LABELS, type MonthGrid } from "./month-grid";
import { eventTimeLabel, splitFixtureEvents } from "./event-display";
import { MatchCell } from "./MatchCell";
import { CompetitionBackdrop } from "../display/CompetitionBackdrop";
import { displayMetadataOf } from "../semantic/metadata-resolver";
import type { MarkAssetSource } from "../semantic/marks";
import type { LunarLabel } from "../semantic/app-lunar";
import type { ChinaDayLabel } from "../semantic/app-china-days";

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
 * - 休假 / 补班（SC-011）同样按日期键注入：格子带上类别与连休区段 id，
 *   相邻格共享同一个区段 id 就说明它们属于同一次连休（CN-004）。这里只挂
 *   data 属性，让「连续区段」在 DOM 里可识别；连续背景、裁切的「休」「补」
 *   大字与多语义冲突规则由 SC-013 消费同一份载荷实现；
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

interface MonthViewProps {
  grid: MonthGrid;
  selectedDateKey: string;
  onSelectDate: (dateKey: string) => void;
  /** 月份步进：-1 上一月，+1 下一月。 */
  onStepMonth: (delta: number) => void;
  onGoToToday: () => void;
  /** 按天移动当前选择（键盘导航）。 */
  onStepSelection: (days: number) => void;
  /** 按日期键分桶的事件（SC-006 导入结果）。 */
  eventsByDate: Map<string, EnrichedEvent[]>;
  /** 按日期键分桶的农历简写（SC-010；范围外的日期缺省，不显示该行）。 */
  lunarByDate?: Map<string, LunarLabel>;
  /** 按日期键分桶的休假 / 补班载荷（SC-011；非假期与未登记年份缺省）。 */
  chinaDayByDate?: Map<string, ChinaDayLabel>;
  /** 队徽 / 联赛 Logo 资源包（SC-022 接入；默认不携带图片）。 */
  assets?: MarkAssetSource;
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
  assets,
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
              return (
                <div
                  key={cell.dateKey}
                  role="gridcell"
                  data-date={cell.dateKey}
                  data-outside={cell.inMonth ? undefined : "true"}
                  data-today={cell.isToday ? "true" : undefined}
                  // 休假 / 补班标记（SC-011）：类别给 SC-013 选语义色与大字，
                  // 区段 id 让相邻格能被识别为同一次连休（CN-004 / §7.1）。
                  data-china-day={chinaDay?.kind}
                  data-china-run={chinaDay?.run?.id}
                  aria-current={cell.isToday ? "date" : undefined}
                  aria-selected={isSelected}
                  tabIndex={cell.dateKey === tabbableDateKey ? 0 : -1}
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
                  <span className="cell-day">{cell.day}</span>
                  {lunar && <span className="cell-lunar">{lunar.cell}</span>}
                  <CellContent
                    events={eventsByDate.get(cell.dateKey)}
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
 * 单格内容：比赛事件渲染“队标 VS 队标”（SC-016 / §10.2），
 * 其余事件按摘要渲染（时间前缀 + 标题，超出上限折叠为计数）。
 * 语义增强（SC-009）只消费 Metadata Resolver 的输出：accent、
 * data-semantic-type 与对阵载荷都是通用管道，组件不含任何球队 / 节日判断。
 */
function CellContent({
  events,
  assets,
}: {
  events: EnrichedEvent[] | undefined;
  assets?: MarkAssetSource;
}) {
  if (!events || events.length === 0) {
    return null;
  }
  const { fixtures, ordinary } = splitFixtureEvents(events);
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

  return (
    <>
      {/* 联赛背景每格只画一次（§10.1），多场比赛共用同一块联赛视觉 */}
      {visibleFixtures.length > 0 && (
        <CompetitionBackdrop
          competition={visibleFixtures[0].fixture.competition}
          className="match-cell-bg"
          assets={assets}
        />
      )}
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
