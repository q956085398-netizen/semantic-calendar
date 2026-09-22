import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { WEEKDAY_LABELS, type MonthGrid } from "./month-grid";

/**
 * 月视图（CAL-001 / CAL-002）：6×7 网格、月份导航、日期选择。
 *
 * - 顶部导航次序遵循 ui-design §5.1：上一月 · 年月 · 下一月 · 今天（次级按钮）；
 * - 选择遵循 WAI-ARIA grid 模式：roving tabindex，选中格 aria-selected；
 * - 方向键 ±1 / ±7 天移动选择，跨出当前月时由 App 联动切换视图；
 * - 键盘 / 点击选择后焦点落在新的选中格，跨月导航后焦点不丢失；
 * - 农历简写与语义视觉分别由 SC-010 / SC-013 填充；
 * - v0.1 只提供月视图，周 / 日入口保留占位但不激活。
 */

/** 方向键 → 天数步进（上下为整周）。 */
const ARROW_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

interface MonthViewProps {
  grid: MonthGrid;
  selectedDateKey: string;
  onSelectDate: (dateKey: string) => void;
  /** 月份步进：-1 上一月，+1 下一月。 */
  onStepMonth: (delta: number) => void;
  onGoToToday: () => void;
  /** 按天移动当前选择（键盘导航）。 */
  onStepSelection: (days: number) => void;
}

export function MonthView({
  grid,
  selectedDateKey,
  onSelectDate,
  onStepMonth,
  onGoToToday,
  onStepSelection,
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
              return (
                <div
                  key={cell.dateKey}
                  role="gridcell"
                  data-date={cell.dateKey}
                  data-outside={cell.inMonth ? undefined : "true"}
                  data-today={cell.isToday ? "true" : undefined}
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
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
