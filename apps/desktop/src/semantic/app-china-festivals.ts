import { chinaFestivals, type Festival } from "../providers/china/festivals";
import {
  festivalBackgroundRef,
  festivalGloss,
} from "../providers/china/festival-labels";
import {
  solarTermBackgroundRef,
  solarTermGloss,
  solarTermOrdinalText,
} from "../providers/china/solar-term-labels";
import { solarTermOfKey, type SolarTerm } from "../providers/china/solar-terms";
import { semanticTypeDefaults } from "./metadata-resolver";

/**
 * 应用级传统节日 / 节气接线（SC-012 / CN-005–006）。
 *
 * 与 app-lunar.ts、app-china-days.ts 同一个角色：UI 不 import Provider 目录
 * （ui-boundary.test.ts），因此节日判定、节气查询与文本规则在这里绑定到应用，
 * 以展示载荷暴露给月视图与详情栏。规则本身在 providers/china/，
 * 这里只负责「把哪些日期算出来、以什么形状交给 UI」。
 *
 * 输入只取日期键——它是月格的稳定标识（选择、事件分桶、农历都用它），
 * 不再重复传年月日，避免同一格出现两套互相矛盾的日期表达。
 *
 * 与休假 / 补班（app-china-days.ts）分开，而不是并进同一个载荷：
 * 两者是不同层的语义——休假 / 补班来自国务院通知（有文号、有数据版本），
 * 节日 / 节气来自历法（由农历与节气表推导）。UI 侧两者也是不同位置：
 * 节日名占月格里的文字行、节气名进角落标签，休假 / 补班是背景与大字（§7–§9）。
 *
 * 顺序即优先级（ui-design §16.1）：一个日期格只允许一个主背景语义，
 * 节日 / 节气专属视觉优先，因此 entries 里节日在前、节气在后，
 * 主背景取第一条——清明节当天同时有「清明节」与「清明」两条，正是这种情形。
 */

/** 单个日级语义（传统节日 / 节气）的展示载荷。 */
export interface ChinaDaySemanticEntry {
  kind: "festival" | "solar-term";
  /** 稳定 id：资源引用与测试用，不参与展示。 */
  id: string;
  /** 主文案：节日名（「中秋节」）/ 节气名（「寒露」）。 */
  name: string;
  /** 英文名（详情栏副标题，大小写由样式决定）。 */
  nameEn: string;
  /** 一句释义（详情栏，ui-design §9.2）。 */
  gloss: string;
  /**
   * 补充信息：节气序号（「第 19 个节气」，§9.2 的可选序号）。
   * 节日没有这一项——农历日期型节日的依据就是详情栏里那行农历，
   * 再写一遍是同一条信息出现两次。
   */
  note?: string;
  /**
   * 语义色 token（§20）：与事件语义、休假 / 补班同一份类型级默认值，
   * UI 不接触具体色值。取不到时 UI 用前景色兜底，不猜一个颜色。
   */
  accent?: string;
  /** 专属背景逻辑引用（§9）；解析与降级见 semantic/day-backdrop.ts。 */
  backgroundRef: string;
}

/** 月格与详情栏需要的日级语义载荷。 */
export interface ChinaDaySemanticLabel {
  /**
   * 当日全部语义：节日在前、节气在后（§16.1 主背景优先级即此顺序）。
   * 普通日期不进 Map——没有语义是常态，不是缺数据。
   */
  entries: readonly ChinaDaySemanticEntry[];
}

/** 日期格的最小输入：只依赖日期键（MonthCell 结构上满足它）。 */
export interface ChinaDaySemanticCellInput {
  dateKey: string;
}

/**
 * 语义类别 → 语义色：取自 metadata-resolver 的类型级默认值
 * （festival / solar-term 在类型表里都有登记，取不到就是类型表被改坏了——
 * 这种情况让载荷缺色，UI 走可见的降级样式，而不是在这里猜一个颜色）。
 */
function accentOf(kind: ChinaDaySemanticEntry["kind"]): string | undefined {
  // kind 本身就是语义类型（festival / solar-term），不需要再映射一层。
  return semanticTypeDefaults(kind)?.accent;
}

function festivalEntry(festival: Festival): ChinaDaySemanticEntry {
  const accent = accentOf("festival");
  return {
    kind: "festival",
    id: festival.id,
    name: festival.name,
    nameEn: festival.nameEn,
    gloss: festivalGloss(festival),
    ...(accent === undefined ? {} : { accent }),
    backgroundRef: festivalBackgroundRef(festival),
  };
}

function solarTermEntry(term: SolarTerm): ChinaDaySemanticEntry {
  const accent = accentOf("solar-term");
  return {
    kind: "solar-term",
    id: term.id,
    name: term.name,
    nameEn: term.nameEn,
    gloss: solarTermGloss(term),
    note: solarTermOrdinalText(term),
    ...(accent === undefined ? {} : { accent }),
    backgroundRef: solarTermBackgroundRef(term),
  };
}

/** 一批日期格 → 日级语义展示载荷，键为日期键 YYYY-MM-DD。 */
export function chinaSemanticLabelsOf(
  cells: readonly ChinaDaySemanticCellInput[],
): Map<string, ChinaDaySemanticLabel> {
  const labels = new Map<string, ChinaDaySemanticLabel>();
  for (const cell of cells) {
    const entries: ChinaDaySemanticEntry[] = chinaFestivals
      .festivalsOfKey(cell.dateKey)
      .map((festival) => festivalEntry(festival));
    const term = solarTermOfKey(cell.dateKey);
    if (term !== undefined) {
      entries.push(solarTermEntry(term));
    }
    if (entries.length === 0) continue;
    labels.set(cell.dateKey, { entries });
  }
  return labels;
}
