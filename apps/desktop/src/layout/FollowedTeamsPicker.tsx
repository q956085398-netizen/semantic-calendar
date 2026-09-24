import type { FixtureTeamDisplay } from "../semantic/metadata-resolver";

/**
 * 关注球队选择器（SC-016 / SPORT-006，ui-design §4 第 3 项）。
 *
 * 只渲染 App 注入的球队展示载荷与当前关注 id：
 * 组件不认识任何球队，也不读写存储——持久化由 App 落到本地数据层。
 * 折叠态用原生 `<details>`：无额外状态、键盘与读屏行为由浏览器保证。
 */

interface FollowedTeamsPickerProps {
  /** 可关注球队（最新赛季名单，顺序由数据层决定）。 */
  teams: FixtureTeamDisplay[];
  /** 已关注的球队 id。 */
  followedIds: readonly string[];
  /** 关注 / 取消关注：参数是球队 id 与目标状态。 */
  onToggleTeam: (teamId: string, followed: boolean) => void;
}

export function FollowedTeamsPicker({
  teams,
  followedIds,
  onToggleTeam,
}: FollowedTeamsPickerProps) {
  return (
    <details className="followed-teams">
      <summary className="followed-teams-summary">
        <span className="sidebar-heading">关注球队</span>
        <span className="followed-teams-count">
          {followedIds.length === 0
            ? "未选择"
            : `已关注 ${followedIds.length} 支`}
        </span>
      </summary>
      {teams.length === 0 ? (
        <p className="followed-teams-empty">暂无可关注的球队</p>
      ) : (
        <ul className="followed-teams-list">
          {teams.map((team) => (
            <li key={team.id}>
              <label className="followed-team">
                <input
                  type="checkbox"
                  className="followed-team-check"
                  checked={followedIds.includes(team.id)}
                  onChange={(event) =>
                    onToggleTeam(team.id, event.target.checked)
                  }
                />
                <span className="followed-team-name">{team.nameZh}</span>
                <span className="followed-team-code">{team.code}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
