import type {
  FixtureCompetitionDisplay,
  FixtureTeamDisplay,
  MarkColors,
} from "../../semantic/metadata-resolver";

/**
 * 队徽 / 联赛 Logo 的资源解析（SC-014，验收：“Logo 缺失有 fallback”、
 * “数据与受版权约束资源分离”）。
 *
 * 元数据层只保存逻辑引用（crest.team.arsenal / logo.competition.premier-league），
 * 仓库里没有任何图片二进制。引用能否解析由部署时装入的资源包决定：
 * 资源包缺失、资源包没收录该引用、或资源包自身抛错，都确定性地
 * 降级为 fallback（球队代码 / 联赛短标签 + 主题色），UI 不会因为没有图而破图。
 *
 * 解析结果只是数据，不含 URL 拼接与图片加载——那是 UI 与资源包的事。
 */

/** 逻辑引用 → 资源地址（打包资源路径或远程 URL）。 */
export interface CrestAssetSource {
  urlFor(ref: string): string | undefined;
}

/** 默认资源包：不附带任何图片（开发原则 §10）。 */
export const NO_CREST_ASSETS: CrestAssetSource = {
  urlFor: () => undefined,
};

export type MarkResolution =
  | { kind: "asset"; ref: string; url: string }
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
  source: CrestAssetSource = NO_CREST_ASSETS,
): MarkResolution {
  if (ref !== undefined && ref !== "") {
    let url: string | undefined;
    try {
      url = source.urlFor(ref);
    } catch {
      url = undefined;
    }
    if (url !== undefined && url !== "") {
      return { kind: "asset", ref, url };
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
export function resolveTeamCrest(
  team: FixtureTeamDisplay,
  source: CrestAssetSource = NO_CREST_ASSETS,
): MarkResolution {
  return resolveMark(
    team.crestRef,
    {
      text: team.code,
      colors: team.colors,
    },
    source,
  );
}

/** 联赛 Logo：fallback 是中文短标签 + 联赛色。 */
export function resolveCompetitionLogo(
  competition: FixtureCompetitionDisplay,
  source: CrestAssetSource = NO_CREST_ASSETS,
): MarkResolution {
  return resolveMark(
    competition.logoRef,
    { text: competition.label, colors: competition.colors },
    source,
  );
}
