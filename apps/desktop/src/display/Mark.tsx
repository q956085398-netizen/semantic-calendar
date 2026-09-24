import type { CSSProperties } from "react";
import type { MarkResolution } from "../semantic/marks";
import { useMarkAsset } from "./mark-asset";

/**
 * 队徽 / 联赛 Logo 的渲染（SC-016 / ui-design §18.1、§22）。
 *
 * 只渲染解析结果（semantic/marks 的 MarkResolution），不认识任何球队：
 * - asset：`<img>` 放进固定比例的容器，素材尺寸不同也不改变布局；
 * - fallback：代码 / 短标签文字 + 主题色，Logo 缺失既不破图也不改变布局；
 * - 图片地址能解析但加载失败：`onError` 降级为同一个 fallback（见 mark-asset.ts）。
 *
 * 尺寸只有两档：月格（sm）与 Inspector（lg）——ui-design §22
 * “Logo 不能决定布局，布局决定 Logo 如何被显示”。
 */

interface MarkProps {
  resolution: MarkResolution;
  /** 无障碍与 hover 文本（球队名 / 联赛名）。 */
  label: string;
  size?: "sm" | "lg";
  /**
   * 装饰性标记：外层的比赛块已经给出了整体描述（“甲队 对 乙队，23:30 开赛”），
   * 这里只保留 hover 提示，不再让读屏重复读一遍。
   */
  decorative?: boolean;
}

export function Mark({
  resolution,
  label,
  size = "sm",
  decorative = false,
}: MarkProps) {
  const { mark, onAssetError } = useMarkAsset(resolution);
  const className = `mark mark-${size}`;

  if (mark.kind === "asset") {
    return (
      <img
        className={`${className} is-asset`}
        src={mark.url}
        alt={decorative ? "" : label}
        title={label}
        aria-hidden={decorative || undefined}
        loading="lazy"
        decoding="async"
        onError={onAssetError}
      />
    );
  }
  // fallback：容器色来自球队 / 联赛色，文字用主题前景色（深浅主题都可读）。
  const style = {
    "--mark-primary": mark.colors.primary,
    "--mark-secondary": mark.colors.secondary,
  } as CSSProperties;
  return (
    <span
      className={`${className} is-fallback`}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      title={label}
      style={style}
    >
      {mark.text}
    </span>
  );
}
