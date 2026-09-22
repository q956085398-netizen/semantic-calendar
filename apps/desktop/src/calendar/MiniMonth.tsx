import { WEEKDAY_LABELS, type MonthGrid } from "./month-grid";

/**
 * 侧栏小月历（ui-design §4 / CAL-002）。
 *
 * 与主视图共用同一份 grid 计算，天然保持同步；点击日期等同主网格选择
 * （跨月日期会联动主视图切换），‹ › 步进月份同时驱动主视图。
 * 小月历只承担导航，不展示事件内容。
 */

interface MiniMonthProps {
  grid: MonthGrid;
  selectedDateKey: string;
  onSelectDate: (dateKey: string) => void;
  /** 月份步进：-1 上一月，+1 下一月。 */
  onStepMonth: (delta: number) => void;
}

export function MiniMonth({
  grid,
  selectedDateKey,
  onSelectDate,
  onStepMonth,
}: MiniMonthProps) {
  const title = `${grid.year}年${grid.month}月`;

  return (
    <nav className="mini-month" aria-label="小月历">
      <div className="mini-month-header">
        <span className="mini-month-title">{title}</span>
        <span className="mini-month-nav">
          <button
            type="button"
            className="mini-nav-button"
            aria-label="上一月"
            onClick={() => onStepMonth(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="mini-nav-button"
            aria-label="下一月"
            onClick={() => onStepMonth(1)}
          >
            ›
          </button>
        </span>
      </div>
      <div className="mini-grid">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="mini-weekday">
            {label}
          </span>
        ))}
        {grid.weeks.flat().map((cell) => (
          <button
            key={cell.dateKey}
            type="button"
            className={[
              "mini-day",
              cell.inMonth ? "" : "is-outside",
              cell.isToday ? "is-today" : "",
              cell.dateKey === selectedDateKey ? "is-selected" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label={`${cell.year}年${cell.month}月${cell.day}日`}
            aria-current={cell.isToday ? "date" : undefined}
            // button 角色不支持 aria-selected；用 toggle 语义表达选中，
            // 与主网格 aria-selected 承担同一信息（§24 颜色之外有状态）。
            aria-pressed={cell.dateKey === selectedDateKey}
            onClick={() => onSelectDate(cell.dateKey)}
          >
            {cell.day}
          </button>
        ))}
      </div>
    </nav>
  );
}
