import { CompetitionBackdrop } from "../display/CompetitionBackdrop";
import { Mark } from "../display/Mark";
import {
  NO_MARK_ASSETS,
  resolveCompetitionMark,
  resolveTeamMark,
  type MarkAssetSource,
} from "../semantic/marks";
import {
  displayMetadataOf,
  type FixtureDisplay,
  type FixtureTeamDisplay,
} from "../semantic/metadata-resolver";
import { reminderLabel } from "../format/reminder";
import { eventTimeLabel } from "../calendar/event-display";
import type { EnrichedEvent } from "../data/model";

/**
 * 比赛日详情（SC-016 / SPORT-005，ui-design §13–15）。
 *
 * 以比赛为视觉中心：对阵双方 + 队徽是一级信息，联赛与开赛时间二级，
 * 场地 / 提醒三级。层级与深浅主题共用同一份结构（§15 沿用相同信息架构），
 * 视觉差异全部由主题变量承担。
 *
 * 缺字段就不渲染该行，不填占位、不给默认值（P-03 / §13 “不伪造数据”）：
 * - 天气：v0.1 没有可靠来源，因此这一行从不出现；
 * - 场地：只有来源事件确实带 LOCATION 时才有值——LOCATION 是事件地点，
 *   未必等于主队球场，因此标题用“场地”而不是“主场”；
 * - 开赛：全天比赛没有开赛时间，不写；
 * - 提醒：写的是策略建议（NOTIFY-003），不是事件数据，因此标题用“建议提醒”。
 *
 * 关注球队（SPORT-006）在这里只做标记：月格不因关注改变（§10.2 只显示
 * 队标 VS 队标），提醒策略由 SC-017 消费同一份关注状态。
 */

interface MatchdayInspectorProps {
  fixture: FixtureDisplay;
  event: EnrichedEvent;
  /** 用户关注的球队 id（SC-016 持久化设置）。 */
  followedTeamIds: readonly string[];
  /** 资源包：默认不携带图片（SC-022 接入）。 */
  assets?: MarkAssetSource;
}

export function MatchdayInspector({
  fixture,
  event,
  followedTeamIds,
  assets = NO_MARK_ASSETS,
}: MatchdayInspectorProps) {
  const [home, away] = fixture.teams;
  const time = eventTimeLabel(event);
  const venue = event.location?.trim();
  const reminder = displayMetadataOf(event)?.reminder;
  const competition = resolveCompetitionMark(fixture.competition, assets);

  return (
    <section
      className="matchday"
      aria-label={`${home.nameZh} 对 ${away.nameZh}`}
    >
      <CompetitionBackdrop
        competition={fixture.competition}
        className="matchday-bg"
        assets={assets}
      />

      <div className="matchday-teams">
        <MatchdayTeam
          team={home}
          assets={assets}
          followed={followedTeamIds.includes(home.id)}
        />
        <span className="matchday-vs" aria-hidden="true">
          VS
        </span>
        <MatchdayTeam
          team={away}
          assets={assets}
          followed={followedTeamIds.includes(away.id)}
        />
      </div>

      <p className="matchday-competition">
        {competition.kind === "asset" && (
          <Mark resolution={competition} label={fixture.competition.nameZh} />
        )}
        {fixture.competition.label}
      </p>

      <dl className="matchday-facts">
        {time !== "" && (
          <>
            {/* 开赛时间属于二级信息（§13.1）：与三级字段同列但视觉更强 */}
            <dt className="matchday-fact-primary">开赛</dt>
            <dd className="matchday-fact-primary">{time}</dd>
          </>
        )}
        {venue !== undefined && venue !== "" && (
          <>
            <dt>场地</dt>
            <dd>{venue}</dd>
          </>
        )}
        {reminder !== undefined && (
          <>
            {/* 提醒是策略建议（NOTIFY-003「比赛可建议赛前 30 分钟」），
                不是事件自带的数据，因此不写成事实陈述 */}
            <dt>建议提醒</dt>
            <dd>{reminderLabel(reminder)}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

/** 一侧球队：队徽 + 中英文名；关注中的球队带“关注”标记。 */
function MatchdayTeam({
  team,
  assets,
  followed,
}: {
  team: FixtureTeamDisplay;
  assets: MarkAssetSource;
  followed: boolean;
}) {
  return (
    <div className="matchday-team">
      <Mark
        resolution={resolveTeamMark(team, assets)}
        label={team.nameZh}
        size="lg"
      />
      <p className="matchday-team-en">{team.nameEn}</p>
      <p className="matchday-team-zh">
        {team.nameZh}
        {followed && <span className="matchday-followed">关注</span>}
      </p>
    </div>
  );
}
