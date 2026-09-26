/**
 * 内置来源开关 → 该进入展示与提醒计划的事件（SC-018 / ui-design §4 第 2 项）。
 *
 * 关闭一个内置来源不删数据：事件、识别结果与设置在数据层原样保留
 * （验收：启停不删除用户数据）。因此这里是“读事件、返回视图事件”的纯函数，
 * 不往存储里写任何状态——存储侧的唯一真相仍是 sources / events /
 * enrichments 三个分区与那一条显示开关设置，重新打开立即恢复，不需要重新匹配。
 *
 * 关闭改变的是**这一份视图**：进来的事件同时供给月格、详情栏与提醒计划，
 * 所以界面上的说法（“关掉英超就不再按比赛提醒”）与真正会发生的事一致。
 *
 * 日级语义（节假日 / 节日节气）不走这里：它们不是事件，展示载荷由 App 按
 * 日期键注入，注入处直接按同一个开关取空载荷。
 */

import type { EnrichedEvent } from "../data/model";
import {
  isBuiltinSourceEnabled,
  type BuiltinSourceId,
} from "../settings/builtin-sources";

/**
 * 应用内置来源开关（「我的日历」与「英超赛程」）。
 *
 * - 「我的日历」关闭：没有用户事件进入视图（月格只留内置语义日期，
 *   提醒计划也随之为空）。它是用户事件来源的组开关，优先级高于其余开关
 *   ——没有事件时，“比赛按普通事件显示”自然也无从谈起；
 * - 「英超赛程」关闭：比赛事件摘掉语义与展示元数据，按普通事件进入月格、
 *   详情栏与提醒计划——与 SEM-003「未命中按普通事件显示」同一条口径。
 *   摘掉的两项都是“视图字段”：识别结果本身仍写在快照的增强分区里
 *   （P-04 把它们分开存储），丢的是联赛视觉、对阵块、比赛详情与比赛提醒。
 *   为什么连 `semantic` 一起摘：提醒计划先看 `semantic.type` 再回落到事件
 *   自带 VALARM（notifications/reminder-plan.ts），只摘展示元数据的话
 *   用户设置过的“比赛提醒”仍会弹——那与界面的承诺矛盾。
 * - 两个开关都开着：原样返回入参（不重建数组，引用不变）。
 *
 * 后续新增内置来源（例如其他联赛 Provider）时在这里扩展：来源 id 与视图
 * 通道的对应关系只有这一处；`sport.fixture` 是当前唯一挂事件的领域语义，
 * 新增时同样要决定“关掉它意味着哪些字段不进入视图”。
 */
export function gateEventsForBuiltinSources(
  events: EnrichedEvent[],
  hidden: readonly BuiltinSourceId[],
): EnrichedEvent[] {
  if (!isBuiltinSourceEnabled(hidden, "mine")) {
    return [];
  }
  if (isBuiltinSourceEnabled(hidden, "premier-league")) {
    return events;
  }
  return events.map(stripFixtureSemantics);
}

/** 比赛事件在视图里退回普通事件：语义与展示元数据都不再进入视图。 */
function stripFixtureSemantics(event: EnrichedEvent): EnrichedEvent {
  if (event.semantic?.type !== "sport.fixture") {
    return event;
  }
  return { ...event, semantic: undefined, metadata: undefined };
}
