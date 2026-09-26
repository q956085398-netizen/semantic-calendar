/**
 * 应用身份（SC-022 / app-spec §18、§20）。
 *
 * 名称策略：同一个应用有三个名字，各自只在一个场合出现——
 *
 * - 界面呈现用中文名「语义日历」（窗口标题、侧栏品牌、托盘提示、通知文案）；
 * - 系统集成用英文名「Semantic Calendar」（安装包文件名、开始菜单、安装目录、
 *   卸载项、文件与安装器属性里的产品名）；
 * - 可执行文件保持 ASCII 的 `semantic-calendar.exe`（来自 Cargo 包名）——
 *   脚本、日志与任务管理器里的名字带空格只会带来麻烦。
 *
 * 版本号只有一个来源：`package.json`，构建时由 Vite 的 `define` 注入
 * `__APP_VERSION__`；`Cargo.toml` 与 `tauri.conf.json` 的版本由
 * `packaging.test.ts` 要求一致，因此界面显示的版本就是安装包里的版本。
 * 这三条与 License 一起在设置页「关于」一节可见。
 */

import type { Fact } from "./facts";

export const APP_NAME_ZH = "语义日历";
export const APP_NAME_EN = "Semantic Calendar";
export const APP_VERSION = __APP_VERSION__;
export const APP_LICENSE = "MIT";

/** 设置页「关于」一节的内容：让人能核对“我装的是哪一版、按什么许可”。 */
export const APP_FACTS: readonly Fact[] = [
  {
    label: "名称",
    value: `${APP_NAME_ZH} / ${APP_NAME_EN}`,
  },
  {
    label: "版本",
    value: APP_VERSION,
  },
  {
    label: "License",
    value: APP_LICENSE,
    detail: "第三方组件、数据与商标另行记录，不在本许可范围内",
  },
];
