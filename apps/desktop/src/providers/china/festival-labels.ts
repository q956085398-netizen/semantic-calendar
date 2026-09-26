import { FESTIVALS, type Festival } from "./festivals";

/**
 * 传统节日的文本与资源引用（SC-012 / CN-005）。
 *
 * 与判定（festivals.ts）分开：哪天是中秋是历法事实，中秋在界面上怎么写、
 * 用哪张背景图是另一件事——改释义、换资源命名，都只动这一层。
 *
 * 口径：
 * - 主标题是节日名（「中秋节」），副标题是英文名；
 * - 释义一句（「八月十五，赏月团圆，食月饼。」），不做百科页面；
 * - 不写「判定依据」行：农历日期型节日的依据就是详情栏里那行农历
 *   （农历八月十五），再写一遍是同一条信息出现两次；除夕的「最后一天」
 *   已经写在释义里。节气那一侧的序号是另一回事（见 solar-term-labels.ts）；
 * - 背景资源是逻辑引用（bg.festival.mid-autumn-festival），由资源包解析，
 *   取不到就是没有背景（开发原则 §10：仓库不分发图片二进制）。
 */

/** 释义：一句白话，写节日在做什么，不写来历长文。 */
const GLOSSES: Readonly<Record<string, string>> = {
  "spring-festival": "农历正月初一，新年开始。",
  "lantern-festival": "正月十五，赏灯吃元宵。",
  "dragon-heads-rising": "二月初二，春耕将始。",
  "qingming-festival": "扫墓祭祖，踏青郊游。",
  "dragon-boat-festival": "五月初五，龙舟竞渡，食粽。",
  "qixi-festival": "七月初七，牛郎织女相会。",
  "ghost-festival": "七月十五，祭祖追思。",
  "mid-autumn-festival": "八月十五，赏月团圆，食月饼。",
  "double-ninth-festival": "九月初九，登高赏菊，敬老。",
  "laba-festival": "腊月初八，煮腊八粥，年味渐浓。",
  "chinese-new-years-eve": "农历年的最后一夜，守岁团圆。",
};

/** 节日释义；表不完整时在装配期就抛错。 */
export function festivalGloss(festival: Festival): string {
  const gloss = GLOSSES[festival.id];
  if (gloss === undefined) {
    throw new Error(`节日缺少释义：${festival.name}（${festival.id}）`);
  }
  return gloss;
}

/**
 * 背景资源逻辑引用：「bg.festival.mid-autumn-festival」。
 * 与节气同一条规则：由 id 派生，资源包里有没有这张图由资源包决定。
 */
export function festivalBackgroundRef(festival: Festival): string {
  return `bg.festival.${festival.id}`;
}

/** 装配期校验：每个节日都有释义。 */
for (const festival of FESTIVALS) {
  festivalGloss(festival);
}
