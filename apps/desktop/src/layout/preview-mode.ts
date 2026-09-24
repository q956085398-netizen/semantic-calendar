/**
 * 浏览器预览模式（没有桌面壳）的统一说法。
 *
 * 预览模式下界面照常可用，但设置写不进本地快照、订阅与导入都不可用——
 * 说法必须与真实情况一致，不能让用户以为改过的设置会留下来（§13）。
 * 三句文案都在这里维护，App 与设置页共用，避免同一个概念出现两种措辞。
 */
export const PREVIEW_SETTINGS_HINT = "浏览器预览模式：改动不写入本地设置";
export const PREVIEW_SUBSCRIBE_HINT = "浏览器预览模式：订阅需要桌面环境";
export const PREVIEW_IMPORT_HINT = "浏览器预览模式：导入需要桌面环境";

/** 设置页顶部的提示；不是预览模式时不显示。 */
export function previewHintOf(previewMode: boolean): string | undefined {
  return previewMode ? PREVIEW_SETTINGS_HINT : undefined;
}
