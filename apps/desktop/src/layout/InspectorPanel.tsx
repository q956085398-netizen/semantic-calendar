import { eventKey, identityOfEvent, type EnrichedEvent } from "../data/model";
import { dateFromKey, parseDateKey } from "../calendar/month-grid";
import { eventTimeLabel } from "../calendar/event-display";

/**
 * 右侧详情栏（ui-design §11–12 / CAL-003）：解释当前选中的日期。
 *
 * SC-005 起由选中日期驱动（点击 / 键盘 / 小月历联动）；
 * SC-006 起列出当日普通事件——只在确实存在时展示（§12.2 不做固定安排填充）；
 * SC-010 起补充农历与语义详情。普通日期保持极简留白。
 */

interface InspectorPanelProps {
  /** 选中的本地日期键 YYYY-MM-DD。 */
  dateKey: string;
  /** 选中日期上的事件（由 App 按日期键分桶后注入）。 */
  events: EnrichedEvent[];
}

export function InspectorPanel({ dateKey, events }: InspectorPanelProps) {
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

      {events.length > 0 && (
        <section
          className="inspector-events"
          aria-labelledby="inspector-events-heading"
        >
          <h2 id="inspector-events-heading" className="sidebar-heading">
            事件
          </h2>
          <ul className="inspector-event-list">
            {events.map((event) => (
              <li
                key={eventKey(identityOfEvent(event))}
                className="inspector-event"
              >
                <span className="inspector-event-time">
                  {event.allDay ? "全天" : eventTimeLabel(event)}
                </span>
                <span className="inspector-event-title">
                  {event.title || "（无标题）"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <span className="inspector-watermark" aria-hidden="true">
        {day}
      </span>
    </div>
  );
}
