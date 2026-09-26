/**
 * 日级语义背景的资源解析（SC-012 / ui-design §9）。
 *
 * 传统节日与节气允许有专属背景，但仓库里不分发任何图片二进制（开发原则 §10）：
 * Provider 只保存逻辑引用（bg.festival.mid-autumn-festival、
 * bg.solar-term.cold-dew），引用能否解析由部署时装入的资源包决定。
 *
 * 当前进度：载荷会带上 backgroundRef，月格与详情栏把它写成 data 属性，
 * **把背景画出来（局部裁切、降饱和、深浅主题的遮罩）归 SC-013**——
 * 它同时也负责「一个日期格只允许一个主背景」的冲突规则，因此渲染与
 * 解析必须一起做。本模块先把「引用 → 资源地址」这一步独立出来并测好：
 * SC-013 拿到的是确定性的结果（有地址或没有），不需要自己兜资源包的错。
 *
 * 与队徽 / 联赛 Logo（marks.ts）是同一套办法，但降级结果不同：标记缺图时用
 * 球队代码 / 联赛短标签兜底，背景缺图时就是不画背景——日期格里的公历日数字、
 * 农历与语义文字照常显示，格子不会因为缺图而破相。因此这里不返回 fallback
 * 文本，只回答「有没有可用的资源地址」。
 *
 * 资源包接口与 MarkAssetSource 结构相同（urlFor），刻意不合并成一个具名类型：
 * 一个是中国日历的日级背景，一个是球队 / 联赛标记，两者只是恰好同形。
 * 结构相同意味着 SC-013 侧一个 assets prop 就能同时传给两者。
 * 解析逻辑的重复同理先留着：两处的缺省语义不同（一个有 fallback，一个没有），
 * 等第三个使用方出现再抽（与 date-key.ts 同一条口径）。
 */

/** 逻辑引用 → 资源地址（打包资源路径或远程 URL）。 */
export interface DayBackdropSource {
  urlFor(ref: string): string | undefined;
}

/** 默认资源包：不附带任何图片（开发原则 §10）。 */
export const NO_DAY_BACKDROPS: DayBackdropSource = {
  urlFor: () => undefined,
};

/**
 * 背景逻辑引用 → 资源地址。
 * 没有引用、资源包缺失、资源包未收录该引用、或资源包自身抛错，都返回
 * undefined（确定性地降级为「没有背景」），调用方不需要自己兜错。
 */
export function dayBackdropUrl(
  ref: string | undefined,
  source: DayBackdropSource = NO_DAY_BACKDROPS,
): string | undefined {
  if (ref === undefined || ref === "") {
    return undefined;
  }
  let url: string | undefined;
  try {
    url = source.urlFor(ref);
  } catch {
    return undefined;
  }
  return url === undefined || url === "" ? undefined : url;
}
