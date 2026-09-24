import {
  chinaHolidays,
  type ChinaDayKind,
  type ChinaDayRun,
} from "../providers/china/holidays";
import {
  chinaDayGlyph,
  chinaDayLabelText,
  chinaDayPositionText,
} from "../providers/china/holiday-labels";
import { semanticTypeDefaults } from "./metadata-resolver";

/**
 * 应用级节假日接线（SC-011 / CN-002–004）。
 *
 * 与 app-lunar.ts 同一个角色：UI 不 import Provider 目录
 * （ui-boundary.test.ts），因此休假 / 补班的查询与文本规则在这里绑定到应用，
 * 以展示载荷暴露给月视图与详情栏。规则本身在 providers/china/，
 * 这里只负责「把哪些日期算出来、以什么形状交给 UI」。
 *
 * 输入只取日期键——它是月格的稳定标识（选择、事件分桶、农历都用它），
 * 不再重复传年月日，避免同一格出现两套互相矛盾的日期表达。
 *
 * 未登记安排的日期不进 Map：月视图少一个休 / 补语义，而不是猜一个假期出来。
 *
 * 日级语义与事件语义的区别：法定节假日不是某条日历事件的属性，而是日期
 * 本身的属性（同一天可以有任意多事件，也可以一个都没有）。因此它不经过
 * 事件 Matcher Engine（matcher-engine.ts 的输入是 NormalizedEvent），
 * 而与农历一样以日期键为入口——SC-013 的月格渲染与冲突规则消费同一份载荷。
 */

/** 月格与详情栏需要的节假日展示载荷。 */
export interface ChinaDayLabel {
  /** 语义类别：休假 / 补班（CN-003：两者语义不同，UI 不靠布尔标志区分）。 */
  kind: ChinaDayKind;
  /** 语义大字：休 / 补（ui-design §7.2 / §8.2）；字号、裁切由 UI 决定。 */
  glyph: string;
  /**
   * 语义色 token（§20）：与事件语义同一份类型级默认值，UI 不接触具体色值。
   * 与事件元数据的 accent 一样可缺省——取不到时 UI 用前景色兜底，
   * 而不是猜一个颜色（当前的两种类别都有登记，测试锁定了这一点）。
   */
  accent?: string;
  /** 主文案：「国庆节、中秋节假期」「国庆节补班日」。 */
  label: string;
  /** 连休位置：「第 2 天 / 共 9 天」；单日假期与补班日缺省。 */
  position?: string;
  /**
   * 连休区段（仅休假，CN-004）：同一次连休的相邻日期格拿到相同 id，
   * 可以直接画成连续背景（ui-design §7.1）；补班日没有区段。
   */
  run?: ChinaDayRun;
}

/** 日期格的最小输入：只依赖日期键（MonthCell 结构上满足它）。 */
export interface ChinaDayCellInput {
  dateKey: string;
}

/**
 * 语义类别 → 语义色：取自 metadata-resolver 的类型级默认值。
 * 休假与补班在类型表里都有登记，取不到就是类型表被改坏了——
 * 这种情况让载荷缺色（UI 走可见的降级样式），而不是在这里猜一个颜色。
 */
function accentOf(kind: ChinaDayKind): string | undefined {
  return semanticTypeDefaults(kind === "rest" ? "holiday" : "makeup-workday")
    ?.accent;
}

/** 一批日期格 → 节假日展示载荷，键为日期键 YYYY-MM-DD。 */
export function chinaDayLabelsOf(
  cells: readonly ChinaDayCellInput[],
): Map<string, ChinaDayLabel> {
  const labels = new Map<string, ChinaDayLabel>();
  for (const cell of cells) {
    const day = chinaHolidays.chinaHolidayOfKey(cell.dateKey);
    if (day === undefined) continue;
    const position = chinaDayPositionText(day);
    const accent = accentOf(day.kind);
    labels.set(cell.dateKey, {
      kind: day.kind,
      glyph: chinaDayGlyph(day.kind),
      ...(accent === undefined ? {} : { accent }),
      label: chinaDayLabelText(day),
      ...(position === undefined ? {} : { position }),
      ...(day.kind === "rest" ? { run: day.run } : {}),
    });
  }
  return labels;
}
