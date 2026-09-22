import { WEEKDAY_LABELS, type MonthGrid } from "./month-grid";

/**
 * 月视图（CAL-001）：6×7 网格、跨月日期、今天状态。
 *
 * 月份导航 / 日期选择 / 选中状态属于 SC-005；
 * 农历简写与语义视觉分别由 SC-010 / SC-013 填充。
 * v0.1 只提供月视图，周 / 日入口保留占位但不激活。
 */

interface MonthViewProps {
  grid: MonthGrid;
}

export function MonthView({ grid }: MonthViewProps) {
  const title = `${grid.year}年${grid.month}月`;

  return (
    <section className="month-view" aria-label={title}>
      <header className="month-header">
        <h2 className="month-title">{title}</h2>
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

      <div className="month-grid" role="grid" aria-label={title}>
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
            {week.map((cell) => (
              <div
                key={cell.dateKey}
                role="gridcell"
                data-date={cell.dateKey}
                data-outside={cell.inMonth ? undefined : "true"}
                data-today={cell.isToday ? "true" : undefined}
                aria-current={cell.isToday ? "date" : undefined}
                className={[
                  "month-cell",
                  cell.inMonth ? "" : "is-outside",
                  cell.isToday ? "is-today" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="cell-day">{cell.day}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
