import { Mark } from "../display/Mark";
import {
  NO_MARK_ASSETS,
  resolveTeamMark,
  type MarkAssetSource,
} from "../semantic/marks";
import type { FixtureDisplay } from "../semantic/metadata-resolver";
import { eventTimeLabel, type FixtureEvent } from "./event-display";

/**
 * 比赛月格（SC-016 / SPORT-004，ui-design §10）。
 *
 * 格内只显示“队标 VS 队标”，外加被格子裁切的联赛背景视觉：
 * 队名、开赛时间、球场、天气、提醒都属于右侧 Inspector（§10.2）。
 * 队徽 / Logo 缺失时按 fallback 渲染（球队代码 / 联赛短标签），
 * 组件本身不认识任何球队——全部字段来自 Resolver 输出的对阵载荷。
 *
 * 背景层（display/CompetitionBackdrop）是格子的直接子元素
 * （格子本身 position: relative + overflow: hidden），所以它可以很大却一定
 * 被裁在格内（§10.1 “不允许溢出到相邻日期格”）；一天多场比赛时背景只画
 * 一次（由 CellContent 决定），避免多层叠加。
 */

interface MatchCellProps {
  fixture: FixtureDisplay;
  event: FixtureEvent["event"];
  /** 资源包：默认不携带图片（SC-022 接入）。 */
  assets?: MarkAssetSource;
}

export function MatchCell({
  fixture,
  event,
  assets = NO_MARK_ASSETS,
}: MatchCellProps) {
  const [home, away] = fixture.teams;
  const time = eventTimeLabel(event);
  const matchup = `${home.nameZh} vs ${away.nameZh}`;
  // hover 提示（§18.1）：对阵 + 开赛时间；全天比赛没有时间就不写。
  const tooltip = time === "" ? matchup : `${matchup} · ${time}`;

  return (
    <div className="match-cell">
      <div
        className="match-cell-teams"
        role="img"
        aria-label={tooltip}
        title={tooltip}
      >
        <Mark
          resolution={resolveTeamMark(home, assets)}
          label={home.nameZh}
          decorative
        />
        <span className="match-cell-vs">VS</span>
        <Mark
          resolution={resolveTeamMark(away, assets)}
          label={away.nameZh}
          decorative
        />
      </div>
    </div>
  );
}
