import type { ChinaDayLabel } from "../semantic/app-china-days";
import type { ChinaDaySemanticLabel } from "../semantic/app-china-festivals";
import type { FixtureDisplay } from "../semantic/metadata-resolver";

/**
 * 日期格主背景判定（SC-013 / ui-design §16.1）。
 *
 * §16 的核心规则是两句：「一个日期格只允许一个主背景语义，但可以存在多个
 * 状态语义」。本模块回答前半句——这个格子画哪一个主背景。
 *
 * 优先级（§16.1 的「建议优先级」，与两张参考图一致）：
 *
 * 1. 实际可用的传统节日 / 节气专属图片（载荷 entries[0]，节日在前）；
 * 2. 体育联赛视觉（当日第一场完整对阵载荷的联赛）；
 * 3. 假期 / 补班：底色 + 大「休」「补」；
 * 4. 普通日期（不画背景层，格子回到安静的基线状态，§6）。
 *
 * 「休」「补」大字属于第 3 项，而不是叠加在任意背景上的状态标记——§7.2 / §8.2
 * 把它定义为背景元素，参考图也正是这么画的：10 月 4 日是休假 + 比赛，格子只有
 * 狮标与队标 VS 队标，没有假期底色、也没有大「休」；10 月 6 日是节日 + 休假，
 * 图片可用时格子只有节日专属视觉；未配置或加载失败时保留假期底色。一个格子画了更强的背景就不再画假期那一套，否则会同时
 * 出现狮标、队标与一个巨大的「休」，正是 §26 要避免的「视觉元素堆叠失控」。
 *
 * 放假这个事实不会因此丢：详情栏给出假期名（放假且有连休时还有「第 3 天 /
 * 共 7 天」，SC-011 的载荷），而连休的连续性由同一次假期里每一天的同一支底色
 * 表达（§7.1 / CN-004）——被节日或比赛拿走主背景的那一天，本来也不是靠底色
 * 读出来的。
 *
 * 判断只用展示载荷里已有的字段（entries[0] / fixture / kind），
 * 不重新做季节、球队或假期判断（开发原则 §3：业务规则不进 UI）。
 */

/** 节日 / 节气专属视觉（§9）：来自日级语义载荷的第一条。 */
export interface DaySemanticBackdrop {
  /** 语义类别，与载荷条目同值；UI 不需要再分辨一次。 */
  kind: "festival" | "solar-term";
  /** 专属背景逻辑引用（§9）；解析与降级见 semantic/day-backdrop.ts。 */
  ref: string;
}

/** 联赛视觉（§10.1）：大面积低透明度狮标 / Logo，裁切在格子内。 */
export interface LeagueBackdrop {
  kind: "league";
  competition: FixtureDisplay["competition"];
}

/** 假期 / 补班（§7.1 / §8.1）：底色与大字的取值都来自 SC-011 的载荷。 */
export interface HolidayBackdrop {
  kind: "holiday";
}

/** 普通日期：不画背景层。 */
export interface NoBackdrop {
  kind: "none";
}

export type CellBackdrop =
  DaySemanticBackdrop | LeagueBackdrop | HolidayBackdrop | NoBackdrop;

/**
 * 主背景判定需要的最小事件输入：只需要已收窄的对阵载荷。
 * `FixtureEvent`（calendar/event-display.ts）结构上满足它——判定不关心
 * 事件本身，只有 Resolver 给出完整对阵载荷的事件才算联赛视觉（SEM-003）。
 */
export interface CellBackdropFixtureInput {
  fixture: FixtureDisplay;
}

export interface CellBackdropInput {
  /** 传统节日 / 节气载荷（SC-012）；普通日期缺省。 */
  chinaSemantic?: ChinaDaySemanticLabel;
  /** 只有实际可用的专属图片才取得主背景；语义文字不占用背景。 */
  dayBackdropAvailable?: boolean;
  /** 当日事件里带完整对阵载荷的比赛（SC-016）；没有比赛时缺省或空数组。 */
  fixtures?: readonly CellBackdropFixtureInput[];
  /** 休假 / 补班载荷（SC-011）；普通日期缺省。 */
  chinaDay?: ChinaDayLabel;
}

/**
 * 一个日期格 → 唯一的主背景。缺省一律是 `none`：载荷缺失、范围外年份、
 * 事件没有对阵载荷，都安静地退回普通日期，不猜一个背景出来（P-03）。
 */
export function cellBackdropOf(input: CellBackdropInput): CellBackdrop {
  const primary = input.chinaSemantic?.entries[0];
  if (primary !== undefined && input.dayBackdropAvailable === true) {
    return { kind: primary.kind, ref: primary.backgroundRef };
  }

  const competition = input.fixtures?.[0]?.fixture.competition;
  if (competition !== undefined) {
    return { kind: "league", competition };
  }

  if (input.chinaDay !== undefined) {
    return { kind: "holiday" };
  }

  return { kind: "none" };
}
