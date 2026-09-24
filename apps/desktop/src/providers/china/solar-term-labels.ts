import { SOLAR_TERMS, type SolarTerm } from "./solar-terms";

/**
 * 二十四节气的文本与资源引用（SC-012 / CN-006）。
 *
 * 与查询（solar-terms.ts）分开：哪一天是寒露是事实，寒露在界面上怎么写、
 * 用哪张背景图是另一件事——改释义、加序号写法、换资源命名，都只动这一层。
 *
 * 口径按 ui-design §9.2 的详情栏示例：
 * - 主标题是节气名（「寒露」），副标题是英文名（「COLD DEW」，大小写由样式决定）；
 * - 释义只有一句（「露气寒冷，将凝结也。」），不做百科页面、不放大段知识文本；
 * - 序号（「第 19 个节气」）是补充信息，不是主标题。
 *
 * 背景资源引用是逻辑引用（bg.solar-term.cold-dew），仓库里没有任何图片二进制
 * （开发原则 §10）。引用由部署时装入的资源包解析，取不到就是没有背景——
 * 节气名与释义照常显示，界面不会因为缺图而破相。解析接口见
 * semantic/day-backdrop.ts，接入与许可审查由 SC-022 处理。
 */

/** 释义：一句白话，取自节气含义本身（寒露一句与 ui-design §9.2 示例一致）。 */
const GLOSSES: Readonly<Record<string, string>> = {
  "minor-cold": "寒气渐盛，尚未到极点。",
  "major-cold": "一年中最冷的时节。",
  "start-of-spring": "春季开始，万物复苏。",
  "rain-water": "降雨渐多，冰雪消融。",
  "awakening-of-insects": "春雷始鸣，蛰虫惊而出走。",
  "spring-equinox": "昼夜均分，春季过半。",
  "pure-brightness": "气清景明，万物皆显。",
  "grain-rain": "雨生百谷，播种时节。",
  "start-of-summer": "夏季开始，作物生长旺盛。",
  "grain-buds": "夏熟作物籽粒渐满。",
  "grain-in-ear": "有芒作物成熟，忙收忙种。",
  "summer-solstice": "北半球白昼最长。",
  "minor-heat": "暑气渐盛，尚未到极热。",
  "major-heat": "一年中最热的时节。",
  "start-of-autumn": "秋季开始，暑气未消。",
  "end-of-heat": "暑气到此为止。",
  "white-dew": "夜间水汽凝露，天气转凉。",
  "autumn-equinox": "昼夜均分，秋季过半。",
  "cold-dew": "露气寒冷，将凝结也。",
  "frost-descent": "天气渐冷，初霜出现。",
  "start-of-winter": "冬季开始，万物收藏。",
  "minor-snow": "开始降雪，尚未积雪。",
  "major-snow": "降雪渐多，天气更冷。",
  "winter-solstice": "北半球白昼最短，数九开始。",
};

/** 节气释义；表不完整时在装配期就抛错（少一句释义不该悄悄变成空白详情栏）。 */
export function solarTermGloss(term: SolarTerm): string {
  const gloss = GLOSSES[term.id];
  if (gloss === undefined) {
    throw new Error(`节气缺少释义：${term.name}（${term.id}）`);
  }
  return gloss;
}

/** 序号文案：「第 19 个节气」。 */
export function solarTermOrdinalText(term: SolarTerm): string {
  return `第 ${term.index} 个节气`;
}

/**
 * 背景资源逻辑引用：「bg.solar-term.cold-dew」。
 * 由节气 id 派生而不是逐条登记：新增节气时不会漏配引用，
 * 资源包里有没有这张图由资源包自己决定。
 */
export function solarTermBackgroundRef(term: SolarTerm): string {
  return `bg.solar-term.${term.id}`;
}

/** 装配期校验：每个节气都有释义。 */
for (const term of SOLAR_TERMS) {
  solarTermGloss(term);
}
