/**
 * 只读事实（SC-018 区域 / SC-022 关于）：术语、当前取值，以及取值意味着什么。
 *
 * 设置页里有两节是「陈述事实、没有可改的控件」——区域（语言 / 周起始 / 时区固定）
 * 与关于（名称 / 版本 / License）。两者共用同一个形状与同一个渲染组件
 * (`layout/FactList.tsx`)，因此不必各自维护一份排版。
 */
export interface Fact {
  label: string;
  /** 当前取值。 */
  value: string;
  /** 取值从哪里来、意味着什么。 */
  detail?: string;
}
