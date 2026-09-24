import type { CSSProperties } from "react";
import { eventKey, identityOfEvent, type EnrichedEvent } from "../data/model";
import { dateFromKey, parseDateKey } from "../calendar/month-grid";
import { eventTimeLabel, splitFixtureEvents } from "../calendar/event-display";
import { displayMetadataOf } from "../semantic/metadata-resolver";
import type { MarkAssetSource } from "../semantic/marks";
import { MatchdayInspector } from "./MatchdayInspector";

/**
 * 右侧详情栏（ui-design §11–13 / CAL-003）：解释当前选中的日期。
 *
 * SC-005 起由选中日期驱动（点击 / 键盘 / 小月历联动）；
 * SC-006 起列出当日普通事件——只在确实存在时展示（§12.2 不做固定安排填充）；
 * SC-009 起增强事件带语义色与短标签（Metadata Resolver 输出，无领域判断）；
 * SC-016 起当日有比赛时以比赛为视觉中心（§13）：星期行追加 MATCHDAY，
 * 对阵双方 / 队徽 / 联赛 / 开赛 / 场地 / 提醒由 MatchdayInspector 渲染，
 * 当日其余事件仍作为状态语义列在下方。
 * 农历与语义详情由 SC-010 补充。普通日期保持极简留白。
 */

interface InspectorPanelProps {
  /** 选中的本地日期键 YYYY-MM-DD。 */
  dateKey: string;
  /** 选中日期上的事件（由 App 按日期键分桶后注入）。 */
  events: EnrichedEvent[];
  /** 用户关注的球队 id（SC-016）；只在比赛详情里做标记。 */
  followedTeamIds?: readonly string[];
  /** 队徽 / 联赛 Logo 资源包（SC-022 接入；默认不携带图片）。 */
  assets?: MarkAssetSource;
}

export function InspectorPanel({
  dateKey,
  events,
  followedTeamIds = [],
  assets,
}: InspectorPanelProps) {
  const { year, month, day } = parseDateKey(dateKey);
  const date = dateFromKey(dateKey);

  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" })
    .format(date)
    .toUpperCase();
  const monthDay = `${month}月${day}日`;
  const { fixtures, ordinary } = splitFixtureEvents(events);
  const isMatchday = fixtures.length > 0;

  return (
    <div
      className={isMatchday ? "inspector is-matchday" : "inspector"}
      data-matchday={isMatchday ? "true" : undefined}
    >
      <p className="inspector-weekday">
        {weekday}
        {isMatchday && " · MATCHDAY"}
      </p>
      <p className="inspector-date">{monthDay}</p>
      <p className="inspector-year">{year}</p>

      {fixtures.map(({ event, fixture }) => (
        <MatchdayInspector
          key={eventKey(identityOfEvent(event))}
          fixture={fixture}
          event={event}
          followedTeamIds={followedTeamIds}
          assets={assets}
        />
      ))}

      {ordinary.length > 0 && (
        <section
          className="inspector-events"
          aria-labelledby="inspector-events-heading"
        >
          <h2 id="inspector-events-heading" className="sidebar-heading">
            事件
          </h2>
          <ul className="inspector-event-list">
            {ordinary.map((event) => {
              const metadata = displayMetadataOf(event);
              return (
                <li
                  key={eventKey(identityOfEvent(event))}
                  className={
                    metadata?.accent
                      ? "inspector-event is-semantic"
                      : "inspector-event"
                  }
                  data-semantic-type={event.semantic?.type}
                  style={
                    metadata?.accent
                      ? ({
                          "--event-accent": metadata.accent,
                        } as CSSProperties)
                      : undefined
                  }
                >
                  <span className="inspector-event-time">
                    {event.allDay ? "全天" : eventTimeLabel(event)}
                  </span>
                  <span className="inspector-event-title">
                    {event.title || "（无标题）"}
                  </span>
                  {metadata?.label && (
                    <span className="inspector-event-badge">
                      {metadata.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <span className="inspector-watermark" aria-hidden="true">
        {day}
      </span>
    </div>
  );
}
