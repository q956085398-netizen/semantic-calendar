import type {
  FixtureCompetitionDisplay,
  FixtureTeamDisplay,
  MarkColors,
} from "./metadata-resolver";

/**
 * 队徽 / Logo 等“标记”的资源解析（SC-014 起，SC-016 移到核心层）。
 *
 * 元数据层只保存逻辑引用（crest.team.arsenal / logo.competition.premier-league），
 * 仓库里没有任何图片二进制。引用能否解析由部署时装入的资源包决定：
 * 资源包缺失、资源包没收录该引用、或资源包自身抛错，都确定性地
 * 降级为 fallback（球队代码 / 联赛短标签 + 主题色），UI 不会因为没有图而破图。
 *
 * 解析结果只是数据，不含 URL 拼接与图片加载——那是 UI 与资源包的事。
 *
 * 位置：解析规则针对的是核心的展示契约（FixtureDisplay），fallback 取值也来自
 * 契约字段本身（code / label / colors），因此它属于核心而不是某个 Provider；
 * SC-016 起月格与 Inspector 都要渲染标记，UI 又不能 import Provider 目录
 * （ui-boundary.test.ts），放在核心是唯一同时满足这两条的位置。
 */

/** 逻辑引用 → 资源地址（打包资源路径或远程 URL）。 */
export interface MarkAssetSource {
  urlFor(ref: string): string | undefined;
}

/** 默认资源包：不附带任何图片（开发原则 §10）。 */
export const NO_MARK_ASSETS: MarkAssetSource = {
  urlFor: () => undefined,
};

export type MarkResolution =
  | {
      kind: "asset";
      ref: string;
      url: string;
      /**
       * 该引用的 fallback 取值。资源地址能解析、图片却加载失败时
       * （资源包版本不匹配、文件损坏），渲染层用它在 onError 里降级——
       * 解析层看不到加载结果，所以 fallback 必须随解析结果一起交给渲染层。
       */
      fallback: MarkFallback;
    }
  | { kind: "fallback"; ref?: string; text: string; colors: MarkColors };

export interface MarkFallback {
  /** fallback 展示文本：球队用 3 字母代码，联赛用中文短标签。 */
  text: string;
  colors: MarkColors;
}

/**
 * 解析一个“标记”（队徽或联赛 Logo）。
 * 资源包抛错按“没有资源”处理：展示层永远拿得到可渲染结果。
 */
export function resolveMark(
  ref: string | undefined,
  fallback: MarkFallback,
  source: MarkAssetSource = NO_MARK_ASSETS,
): MarkResolution {
  if (ref !== undefined && ref !== "") {
    let url: string | undefined;
    try {
      url = source.urlFor(ref);
    } catch {
      url = undefined;
    }
    if (url !== undefined && url !== "") {
      return { kind: "asset", ref, url, fallback };
    }
    return {
      kind: "fallback",
      ref,
      text: fallback.text,
      colors: fallback.colors,
    };
  }
  return { kind: "fallback", text: fallback.text, colors: fallback.colors };
}

/** 球队徽标：fallback 是 3 字母代码 + 球队色（ui-design §18.1 队标位）。 */
export function resolveTeamMark(
  team: FixtureTeamDisplay,
  source: MarkAssetSource = NO_MARK_ASSETS,
): MarkResolution {
  return resolveMark(
    team.crestRef,
    { text: team.code, colors: team.colors },
    source,
  );
}

/** 联赛 Logo：fallback 是中文短标签 + 联赛色。 */
export function resolveCompetitionMark(
  competition: FixtureCompetitionDisplay,
  source: MarkAssetSource = NO_MARK_ASSETS,
): MarkResolution {
  return resolveMark(
    competition.logoRef,
    { text: competition.label, colors: competition.colors },
    source,
  );
}
