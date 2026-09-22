/**
 * 右侧详情栏（ui-design §11–12）：解释当前选中日期。
 *
 * SC-004 阶段没有选择状态，展示“今天”的极简日期详情；
 * SC-005 接管日期选择，SC-010 起补充农历与语义详情。
 * 普通日期允许留白，不制造“今日安排”式填充内容。
 */

interface InspectorPanelProps {
  date: Date;
}

export function InspectorPanel({ date }: InspectorPanelProps) {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" })
    .format(date)
    .toUpperCase();
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;

  return (
    <div className="inspector">
      <p className="inspector-weekday">{weekday}</p>
      <p className="inspector-date">{monthDay}</p>
      <p className="inspector-year">{date.getFullYear()}</p>
      <span className="inspector-watermark" aria-hidden="true">
        {date.getDate()}
      </span>
    </div>
  );
}
