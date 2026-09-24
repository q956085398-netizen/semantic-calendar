import { useCallback, useState } from "react";
import type { MarkResolution } from "../semantic/marks";

/**
 * 解析结果 → 实际渲染用的标记（SC-016 / app-spec §13 “Logo 缺失不破坏 UI”）。
 *
 * `semantic/marks.ts` 的 fallback 覆盖三种情况：没有逻辑引用、资源包没有
 * 这个引用、资源包自身抛错。它覆盖不了第四种——地址能解析、图片却加载失败
 * （资源包版本不匹配、文件损坏、离线时远程地址不可达）。解析层看不到加载
 * 结果，所以这里把 `onAssetError` 交给渲染层：图片一旦报错就换成解析结果
 * 自带的 fallback，界面不会出现破图。
 */
export function useMarkAsset(resolution: MarkResolution): {
  /** 可渲染结果：图片加载失败时已降级为 fallback。 */
  mark: MarkResolution;
  /** 交给 `<img onError>`：只对 asset 分支有意义。 */
  onAssetError: () => void;
} {
  const [failed, setFailed] = useState(false);
  const onAssetError = useCallback(() => setFailed(true), []);
  if (resolution.kind === "asset" && failed) {
    return {
      mark: {
        kind: "fallback",
        ref: resolution.ref,
        text: resolution.fallback.text,
        colors: resolution.fallback.colors,
      },
      onAssetError,
    };
  }
  return { mark: resolution, onAssetError };
}
