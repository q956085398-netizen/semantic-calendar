/**
 * 本地数据层状态的说法（SC-019 / app-spec §13）。
 *
 * 三种“不能落盘”的原因完全不同，说法也必须不同：
 * - `preview`：没有桌面壳（浏览器预览），本来就没有本地文件；
 * - `unavailable`：桌面壳在，但快照文件打不开（磁盘错误、权限、迁移链）——
 *   这不是预览模式，日历照常可浏览，但导入与订阅不可用、设置更改不会保存；
 * - `loading` / `ready`：还没有结论 / 一切正常，不给提示。
 *
 * 把这几种状态混成一句“本地数据层初始化失败”就是错误的可解释性：
 * 用户既不知道原因，也不知道下一步会失去什么。文案集中在这里，
 * 侧栏、设置页与导入 / 订阅动作共用同一份措辞。
 *
 * 状态是**一个联合类型**而不是“状态 + 可选原因”两个字段：原因只在
 * 不可用时有意义，拆成两个 state 的话，“已就绪但还带着上次的失败原因”
 * 这种说不通的组合是能写出来的。
 */

export type DataLayerState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "preview" }
  /** 打不开的原因已由调用方脱敏（§14）。 */
  | { kind: "unavailable"; reason: string };

/** 需要数据层的动作：各自的提示要说明“这次动作会发生什么”。 */
export type DataLayerAction = "import" | "subscribe";

/** “改动不写盘”这半句只有一个来源：两种原因的前缀不同，结论相同。 */
const SETTINGS_HINT_SUFFIX = "改动不写入本地设置";

export const PREVIEW_SETTINGS_HINT = `浏览器预览模式：${SETTINGS_HINT_SUFFIX}`;
export const PREVIEW_SUBSCRIBE_HINT = "浏览器预览模式：订阅需要桌面环境";
export const PREVIEW_IMPORT_HINT = "浏览器预览模式：导入需要桌面环境";

export const UNAVAILABLE_SETTINGS_HINT = `本地数据层不可用：${SETTINGS_HINT_SUFFIX}`;

/**
 * 不可用时的动作提示：说清“这次动作不会发生”，而不是“发生了但没保存”
 * ——动作其实被直接拒绝，没有任何一步真正执行过。
 */
export const UNAVAILABLE_SUBSCRIBE_HINT =
  "本地数据层不可用：无法添加订阅（需要可以写入的本地文件）";
export const UNAVAILABLE_IMPORT_HINT =
  "本地数据层不可用：无法导入（需要可以写入的本地文件）";

/** 数据层还没就绪时的动作提示：不说成预览模式，也不假装成功。 */
export const LOADING_ACTION_HINT = "本地数据层尚未就绪：请稍后重试";

/**
 * 初始化失败的状态行。原因来自真实异常（调用方已脱敏），不是一句死文案：
 * “为什么打不开”和“哪些功能会失效”都在这一行里。
 */
export function dataLayerFailureStatus(reason: string): string {
  return `本地数据层不可用（${reason}）：日历可浏览，导入与订阅不可用，设置更改不会保存`;
}

/** 状态 → 侧栏 / 设置页顶部提示；loading 与 ready 没有话要说。 */
export function dataLayerHintOf(state: DataLayerState): string | undefined {
  switch (state.kind) {
    case "preview":
      return PREVIEW_SETTINGS_HINT;
    case "unavailable":
      return `本地数据层不可用（${state.reason}）：${SETTINGS_HINT_SUFFIX}`;
    default:
      return undefined;
  }
}

/** 状态 → 需要数据层的动作被触发时的说明；ready 时没有话要说。 */
export function dataLayerActionHint(
  state: DataLayerState,
  action: DataLayerAction,
): string | undefined {
  const unavailable =
    action === "import" ? UNAVAILABLE_IMPORT_HINT : UNAVAILABLE_SUBSCRIBE_HINT;
  const preview =
    action === "import" ? PREVIEW_IMPORT_HINT : PREVIEW_SUBSCRIBE_HINT;
  switch (state.kind) {
    case "ready":
      return undefined;
    case "unavailable":
      return unavailable;
    case "loading":
      return LOADING_ACTION_HINT;
    case "preview":
      return preview;
  }
}

/**
 * 落盘失败（数据层已打开，但写不进去）的说明：内存里的更改已经生效，
 * 只是没落到磁盘上——用户必须知道这一点，否则“改过的东西重启后消失”
 * 会毫无解释（§13 数据库异常提示）。
 */
export function storeWriteFailureStatus(label: string, reason: string): string {
  return `${label}未能写入本地文件：${reason}（界面已按新状态显示，重启后可能丢失）`;
}

/**
 * 快照读取时被隔离的坏记录（SC-019）：坏记录不会让它旁边的数据一起消失，
 * 但“少了几条”是用户要知道的事实，因此拼进数据层状态行。
 * 没有坏记录时返回 undefined——没有话要说就不说。
 *
 * 这里只说条数，不说名字：被隔离的记录字段本身就不可信，从里面取一个
 * 名字来展示等于把坏数据放进界面。原文另存在备份文件里供人工检查。
 */
export function droppedRecordsNote(dropped: {
  events: number;
  sources: number;
}): string | undefined {
  const parts: string[] = [];
  if (dropped.events > 0) {
    parts.push(`${dropped.events} 个无法读取的事件`);
  }
  if (dropped.sources > 0) {
    parts.push(`${dropped.sources} 个无法读取的来源`);
  }
  return parts.length === 0 ? undefined : `已跳过 ${parts.join("、")}`;
}
