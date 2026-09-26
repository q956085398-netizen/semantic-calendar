import {
  NO_MARK_ASSETS,
  resolveCompetitionMark,
  type MarkAssetSource,
} from "../semantic/marks";
import type { FixtureCompetitionDisplay } from "../semantic/metadata-resolver";
import { useMarkAsset } from "./mark-asset";

/**
 * 联赛背景视觉（SC-016 / ui-design §10.1、§13.2、§15.4）。
 *
 * 日期格与比赛日详情栏共用同一块“大面积低透明度联赛视觉”：
 * 有资源时是 Logo，没有（或加载失败）时是联赛短标签字形——
 * 同一份降级口径，两个位置不会出现两套行为。
 *
 * 组件只输出背景层本身：尺寸由 CSS 决定，裁切由调用方的容器负责
 * （日期格 / 详情栏的 `overflow`），因此这里不参与布局计算。
 */

interface CompetitionBackdropProps {
  competition: FixtureCompetitionDisplay;
  /** 背景层类名；图片元素自动使用 `${className}-image`。 */
  className: string;
  assets?: MarkAssetSource;
}

export function CompetitionBackdrop({
  competition,
  className,
  assets = NO_MARK_ASSETS,
}: CompetitionBackdropProps) {
  const { mark, onAssetError } = useMarkAsset(
    resolveCompetitionMark(competition, assets),
  );

  return (
    <span className={className} aria-hidden="true">
      {mark.kind === "asset" ? (
        <img
          className={`${className}-image`}
          src={mark.url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={onAssetError}
        />
      ) : (
        mark.text
      )}
    </span>
  );
}
