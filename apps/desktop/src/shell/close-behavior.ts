/**
 * 关闭主窗口的行为（SC-002 / app-spec §12）。
 *
 * 语义：关闭按钮到底是“隐藏到系统托盘、应用继续常驻”，还是“退出应用”。
 * 这是用户设置（键 app.closeBehavior），不是 UI 临时状态——设置页（SC-018）
 * 与启动读取共用同一个键与同一套规范化规则。
 *
 * 桌面壳是唯一执行者：前端只把归一化后的值推给 Rust（shell_set_close_behavior），
 * 由 Rust 在收到关闭请求时决定隐藏还是放行退出。
 */

export type CloseBehavior = "hide-to-tray" | "quit";

/** 持久化键名，与快照 settings 命名空间一致。 */
export const CLOSE_BEHAVIOR_SETTING_KEY = "app.closeBehavior";

/** 默认行为：关闭窗口后继续在托盘常驻（常驻日历的预期行为）。 */
export const DEFAULT_CLOSE_BEHAVIOR: CloseBehavior = "hide-to-tray";

export interface CloseBehaviorOption {
  value: CloseBehavior;
  /** 按钮文案。 */
  label: string;
  /** 行为解释，同时作为按钮 title 与当前选项说明。 */
  hint: string;
}

/**
 * 可选项与文案：顺序即 UI 展示顺序。
 * 说明必须写清“应用是否还在运行”，这是两种行为真正的区别。
 *
 * 文案说“隐藏”而不是“最小化”：最小化按钮保持系统默认（最小化到任务栏），
 * 只有关闭窗口才会走到托盘，措辞必须与真实行为一致。
 */
export const CLOSE_BEHAVIOR_OPTIONS: readonly CloseBehaviorOption[] = [
  {
    value: "hide-to-tray",
    label: "隐藏到托盘",
    hint: "关闭窗口后应用继续在系统托盘运行，点击托盘图标即可恢复窗口",
  },
  {
    value: "quit",
    label: "退出应用",
    hint: "关闭窗口即退出应用，不再驻留系统托盘",
  },
];

/**
 * 快照 / 设置中的任意值 → 关闭行为。
 * 只有明确写下的 "quit" 才退出，其余（缺失、坏值、未来新增取值）都按
 * 默认的隐藏到托盘处理——两种行为都不破坏数据，但默认值更符合“常驻”预期。
 */
export function normalizeCloseBehavior(value: unknown): CloseBehavior {
  return value === "quit" ? "quit" : "hide-to-tray";
}

/** 当前行为的解释文案（用于侧栏的状态说明）。 */
export function describeCloseBehavior(behavior: CloseBehavior): string {
  const option = CLOSE_BEHAVIOR_OPTIONS.find(
    (candidate) => candidate.value === behavior,
  );
  return option?.hint ?? "";
}
