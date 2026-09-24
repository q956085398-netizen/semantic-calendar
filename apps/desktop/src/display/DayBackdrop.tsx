import { useCallback, useState } from "react";
import {
  NO_DAY_BACKDROPS,
  dayBackdropUrl,
  type DayBackdropSource,
} from "../semantic/day-backdrop";

/**
 * 节日 / 节气专属背景（SC-013 / ui-design §9.1、§15.3）。
 *
 * 只画背景层本身：图片铺满格子，由格子的 `overflow: hidden` 裁切，
 * 因此素材多大都不会溢出到相邻日期格（§9.1「限制在日期格内部」）。
 * 图层顺序由样式负责（背景层在文字层之下），组件不参与布局计算。
 *
 * 降级只有一种：取不到资源就不画背景（`semantic/day-backdrop.ts` 的口径），
 * 日期数字、农历行与语义名照常显示，格子不会因为缺图而破相。图片地址能解析、
 * 加载却失败时（资源包版本不匹配、文件损坏）同样退回到「没有背景」——
 * 与队徽 / 联赛标记不同，背景没有可读的替代文本，画一个 fallback 只会
 * 多出一块无意义的色块（§6：普通日期之外的一切都要有语义）。
 */
interface DayBackdropProps {
  /** 专属背景逻辑引用（`bg.festival.*` / `bg.solar-term.*`）。 */
  ref: string;
  /** 背景资源包（SC-022 接入；默认不携带图片）。 */
  assets?: DayBackdropSource;
}

export function DayBackdrop({
  ref,
  assets = NO_DAY_BACKDROPS,
}: DayBackdropProps) {
  const url = dayBackdropUrl(ref, assets);
  const [failed, setFailed] = useState(false);
  const onAssetError = useCallback(() => setFailed(true), []);

  if (url === undefined || failed) {
    return null;
  }

  return (
    <span className="cell-backdrop" aria-hidden="true">
      <img
        className="cell-backdrop-image"
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        onError={onAssetError}
      />
      {/* 文字区遮罩（§9.1 / §15.3）：日期数字与语义文字所在的左上角保证对比度，
          右下角保留背景本身的氛围 */}
      <span className="cell-backdrop-scrim" />
    </span>
  );
}
