import { dateFromKey, parseDateKey } from "../calendar/month-grid";

/**
 * 右侧详情栏（ui-design §11–12 / CAL-003）：解释当前选中的日期。
 *
 * SC-005 起由选中日期驱动（点击 / 键盘 / 小月历联动）；
 * SC-010 起补充农历与语义详情。普通日期保持极简留白，
 * 不制造“今日安排”式填充内容。
 */

interface InspectorPanelProps {
  /** 选中的本地日期键 YYYY-MM-DD。 */
  dateKey: string;
}

export function InspectorPanel({ dateKey }: InspectorPanelProps) {
  const { year, month, day } = parseDateKey(dateKey);
  const date = dateFromKey(dateKey);

  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" })
    .format(date)
    .toUpperCase();
  const monthDay = `${month}月${day}日`;

  return (
    <div className="inspector">
      <p className="inspector-weekday">{weekday}</p>
      <p className="inspector-date">{monthDay}</p>
      <p className="inspector-year">{year}</p>
      <span className="inspector-watermark" aria-hidden="true">
        {day}
      </span>
    </div>
  );
}
