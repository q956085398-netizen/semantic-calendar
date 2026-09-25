import type { CSSProperties } from "react";
import { eventKey, identityOfEvent, type EnrichedEvent } from "../data/model";
import { dateFromKey, parseDateKey } from "../calendar/month-grid";
import { eventTimeLabel, splitFixtureEvents } from "../calendar/event-display";
import { localWeekdayLabel } from "../format/time";
import { displayMetadataOf } from "../semantic/metadata-resolver";
import type { MarkAssetSource } from "../semantic/marks";
import type { LunarLabel } from "../semantic/app-lunar";
import type { ChinaDayLabel } from "../semantic/app-china-days";
import type {
  ChinaDaySemanticEntry,
  ChinaDaySemanticLabel,
} from "../semantic/app-china-festivals";
import type { MatchReminderSetting } from "../notifications/notification-settings";
import { MatchdayInspector } from "./MatchdayInspector";

/**
 * 右侧详情栏（ui-design §11–13 / CAL-003）：解释当前选中的日期。
 *
 * SC-005 起由选中日期驱动（点击 / 键盘 / 小月历联动）；
 * SC-006 起列出当日普通事件——只在确实存在时展示（§12.2 不做固定安排填充）；
 * SC-009 起增强事件带语义色与短标签（Metadata Resolver 输出，无领域判断）；
 * SC-010 起日期下补一行农历（§9.2「农历八月廿七」），范围外不显示；
 * SC-011 起放假 / 补班日补一行语义（§11.1 状态类型「节假日」）：大字 + 假期名
 *   与连休位置，文本全部来自 app-china-days 的展示载荷；
 * SC-012 起传统节日 / 节气补上详情块（§11.1 状态类型「传统节日」「二十四节气」）：
 *   星期行追加 FESTIVAL / SOLAR TERM（§9.2 的「THURSDAY · SOLAR TERM」），
 *   块内是名称、英文名、序号与一句释义；同一天两条语义（既是节日又是节气）时
 *   逐条列出，顺序即 §16.1 的主背景优先级；
 * SC-016 起当日有比赛时以比赛为视觉中心（§13）：星期行追加 MATCHDAY，
 *   对阵双方 / 队徽 / 联赛 / 开赛 / 场地 / 提醒由 MatchdayInspector 渲染，
 *   当日其余事件仍作为状态语义列在下方。
 * 月格的休假 / 补班视觉（连续背景、裁切的大字）与多语义冲突规则由 SC-013 实现，
 * 节日 / 节气的专属背景（§9）同样归 SC-013；本组件只呈现文字层。
 */

/** 星期行里的语义类型标签（§9.2）：载荷给类别，这里只负责写法。 */
const SEMANTIC_KIND_LABELS: Record<ChinaDaySemanticEntry["kind"], string> = {
  festival: "FESTIVAL",
  "solar-term": "SOLAR TERM",
};

interface InspectorPanelProps {
  /** 选中的本地日期键 YYYY-MM-DD。 */
  dateKey: string;
  /** 选中日期上的事件（由 App 按日期键分桶后注入）。 */
  events: EnrichedEvent[];
  /** 选中日期的农历展示载荷（SC-010）；范围外缺省，不显示该行。 */
  lunar?: LunarLabel;
  /** 选中日期的休假 / 补班载荷（SC-011）；不是假期就缺省，不显示该行。 */
  chinaDay?: ChinaDayLabel;
  /** 选中日期的传统节日 / 节气载荷（SC-012）；普通日期缺省。 */
  chinaSemantic?: ChinaDaySemanticLabel;
  /** 用户关注的球队 id（SC-016）；只在比赛详情里做标记。 */
  followedTeamIds?: readonly string[];
  /** 比赛提醒提前量的用户设置（SC-017）；提醒行据此说明会不会提醒。 */
  matchReminder?: MatchReminderSetting;
  /** 队徽 / 联赛 Logo 资源包（SC-022 接入；默认不携带图片）。 */
  assets?: MarkAssetSource;
}

export function InspectorPanel({
  dateKey,
  events,
  lunar,
  chinaDay,
  chinaSemantic,
  followedTeamIds = [],
  matchReminder,
  assets,
}: InspectorPanelProps) {
  const { year, month, day } = parseDateKey(dateKey);
  const date = dateFromKey(dateKey);

  const weekday = localWeekdayLabel(date).toUpperCase();
  const monthDay = `${month}月${day}日`;
  const { fixtures, ordinary } = splitFixtureEvents(events);
  const isMatchday = fixtures.length > 0;
  const primaryKind = chinaSemantic?.entries[0]?.kind;

  return (
    <div
      className={isMatchday ? "inspector is-matchday" : "inspector"}
      data-matchday={isMatchday ? "true" : undefined}
    >
      <p className="inspector-weekday">
        {weekday}
        {primaryKind !== undefined && ` · ${SEMANTIC_KIND_LABELS[primaryKind]}`}
        {isMatchday && " · MATCHDAY"}
      </p>
      <p className="inspector-date">{monthDay}</p>
      <p className="inspector-year">{year}</p>
      {lunar && <p className="inspector-lunar">{lunar.detail}</p>}
      {/* 传统节日 / 节气（SC-012 / §11.1）：语义对象本身是详情栏的主角，
          因此排在休假 / 补班这类状态语义之前（§16.1 主背景优先级）。 */}
      {chinaSemantic && (
        <div className="inspector-day-semantics">
          {chinaSemantic.entries.map((entry) => (
            <section
              key={`${entry.kind}:${entry.id}`}
              className="inspector-day-semantic"
              data-china-semantic={entry.kind}
              data-china-backdrop={entry.backgroundRef}
              style={
                entry.accent
                  ? ({ "--day-accent": entry.accent } as CSSProperties)
                  : undefined
              }
            >
              <h2 className="inspector-day-semantic-name">{entry.name}</h2>
              <p className="inspector-day-semantic-name-en">{entry.nameEn}</p>
              {entry.note && (
                <p className="inspector-day-semantic-note">{entry.note}</p>
              )}
              <p className="inspector-day-semantic-gloss">{entry.gloss}</p>
            </section>
          ))}
        </div>
      )}
      {/* 休假 / 补班（SC-011 / §11.1）：大字承担语义，颜色只作类别强调 */}
      {chinaDay && (
        <p
          className="inspector-china-day"
          data-china-day={chinaDay.kind}
          style={
            chinaDay.accent
              ? ({ "--china-day-accent": chinaDay.accent } as CSSProperties)
              : undefined
          }
        >
          <span className="inspector-china-day-glyph" aria-hidden="true">
            {chinaDay.glyph}
          </span>
          <span className="inspector-china-day-label">{chinaDay.label}</span>
          {chinaDay.position && (
            <span className="inspector-china-day-position">
              {chinaDay.position}
            </span>
          )}
        </p>
      )}

      {fixtures.map(({ event, fixture }) => (
        <MatchdayInspector
          key={eventKey(identityOfEvent(event))}
          fixture={fixture}
          event={event}
          followedTeamIds={followedTeamIds}
          matchReminder={matchReminder}
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
