import { lunarDateOfKey } from "../providers/china/lunar";
import {
  lunarCellText,
  lunarDetailText,
} from "../providers/china/lunar-labels";

/**
 * 应用级农历接线（SC-010 / CN-001）。
 *
 * 与 app-followed-teams.ts 同一个角色：UI 不 import Provider 目录
 * （ui-boundary.test.ts），因此农历换算与文本规则在这里绑定到应用，
 * 以展示载荷暴露给月视图与详情栏。规则本身在 providers/china/，
 * 这里只负责“把哪些日期算出来、以什么形状交给 UI”。
 *
 * 输入只取日期键——它是月格的稳定标识（选择、事件分桶都用它），
 * 不再重复传年月日，避免同一格出现两套互相矛盾的日期表达。
 *
 * 范围外（1901-02-19 之前、2100-02-08 之后）的日期不进 Map：
 * 月视图少一行农历，不显示不可靠的换算结果。
 */

/** 月格与详情栏需要的农历展示载荷。 */
export interface LunarLabel {
  /** 月格简写：初一为月名（月份边界），其余为日名。 */
  cell: string;
  /** 详情栏完整写法：农历八月廿七。 */
  detail: string;
}

/** 日期格的最小输入：只依赖日期键（MonthCell 结构上满足它）。 */
export interface LunarCellInput {
  dateKey: string;
}

/** 一批日期格 → 农历展示载荷，键为日期键 YYYY-MM-DD。 */
export function lunarLabelsOf(
  cells: readonly LunarCellInput[],
): Map<string, LunarLabel> {
  const labels = new Map<string, LunarLabel>();
  for (const cell of cells) {
    const lunar = lunarDateOfKey(cell.dateKey);
    if (!lunar) continue;
    labels.set(cell.dateKey, {
      cell: lunarCellText(lunar),
      detail: lunarDetailText(lunar),
    });
  }
  return labels;
}
