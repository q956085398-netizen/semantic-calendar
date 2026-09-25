/**
 * 基础语言 / 区域（SC-018 预留，app-spec §9 SETTINGS）。
 *
 * v0.1 的语言与时区不可配置：界面文案、星期与语义短标签固定中文，月视图
 * 网格固定周一起始（calendar/month-grid.ts，周起始偏好在有真实需求前不引入），
 * 时间按本机时区显示（UTC 事件转本机；带 TZID 的事件按来源时区换算为瞬时，
 * 见 normalize/timezone.ts）。
 *
 * 因此这里**不定义任何设置键**：写一个没有读取方的值，只会让快照出现
 * “看起来设过、其实不生效”的假状态（P-03）。将来接入语言 / 时区时，
 * 键与读取边界一并定义（快照 settings 是开放命名空间，加键不需要迁移）。
 */

import type { Fact } from "./facts";

/** 设置页「区域」一节的内容：陈述当前取值，不假装可配置。 */
export const REGION_FACTS: readonly Fact[] = [
  {
    label: "语言",
    value: "简体中文",
    detail: "界面文案、星期与语义短标签固定为中文",
  },
  {
    label: "一周起始",
    value: "周一",
    detail: "月视图网格与事件分桶按周一起始（CAL-001）",
  },
  {
    label: "时区",
    value: "跟随本机",
    detail: "UTC 事件按本机时区显示；带 TZID 的事件按来源时区换算为瞬时",
  },
];

/** 预留说明：解释为什么这里没有可改的控件。 */
export const REGION_RESERVED_NOTE =
  "v0.1 不提供语言与时区设置，这里只陈述当前固定取值（不写入任何设置键）。";
