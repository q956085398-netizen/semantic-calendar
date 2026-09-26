/**
 * 内置数据源显示开关（SC-018 / ui-design §4 第 2 项、§4.3、app-spec §9 SETTINGS）。
 *
 * 四个内置来源对应侧栏数据源列表里的固定四行（§4.3），它们是产品自带的
 * 内容层，不是用户导入的数据：
 * - mine：用户自己的日历事件（本地导入与订阅）；
 * - cn-holiday：法定节假日、连休与补班（SC-011）；
 * - solar-terms：传统节日与二十四节气（SC-012）；
 * - premier-league：英超比赛语义（SC-014–016）。
 *
 * 快照里存**被隐藏的来源 id**，不是“已启用的 id”：这样默认全开，将来新增
 * 内置来源时对已有快照也是可见的，不需要迁移。读取边界只接受认识的 id
 * ——坏值、未知 id、重复项一律丢弃，不猜成某个来源（P-03）。
 *
 * 关闭只影响展示：识别结果、事件与设置都留在数据层（验收：启停不删除
 * 用户数据），展示侧的消费点是 `semantic/app-builtin-sources.ts`。
 */

export type BuiltinSourceId =
  "mine" | "cn-holiday" | "solar-terms" | "premier-league";

export interface BuiltinSourceDefinition {
  id: BuiltinSourceId;
  /** 展示名，与侧栏数据源行同名（ui-design §4.3）。 */
  name: string;
  /** 一句话说明提供什么；关闭后的效果写进 description，界面不再另写一份。 */
  description: string;
}

/** 顺序即界面顺序：侧栏数据源列表与设置页数据源一节的同一份列表。 */
export const BUILTIN_SOURCES: readonly BuiltinSourceDefinition[] = [
  {
    id: "mine",
    name: "我的日历",
    description: "显示导入与订阅的日程；关闭后仅保留节假日和节气",
  },
  {
    id: "cn-holiday",
    name: "中国节假日",
    description: "显示法定假期与补班；关闭后隐藏「休 / 补」标记",
  },
  {
    id: "solar-terms",
    name: "二十四节气",
    description: "显示传统节日与节气；关闭后隐藏相关名称与详情",
  },
  {
    id: "premier-league",
    name: "英超赛程",
    description: "显示比赛对阵与详情；关闭后按普通日程显示",
  },
];

/** 持久化键名，与快照 settings 命名空间一致。 */
export const BUILTIN_SOURCES_SETTING_KEY = "sources.builtinHidden";

const BUILTIN_SOURCE_IDS: readonly string[] = BUILTIN_SOURCES.map(
  (source) => source.id,
);

function isBuiltinSourceId(value: unknown): value is BuiltinSourceId {
  return typeof value === "string" && BUILTIN_SOURCE_IDS.includes(value);
}

/**
 * 设置值（磁盘 JSON）→ 被隐藏的来源 id 列表。
 * 非数组、未知 id、重复项全部丢弃：读错只会多显示一个来源，
 * 不会把某个来源误当成另一个（P-03）。
 */
export function readHiddenBuiltinSourceIds(raw: unknown): BuiltinSourceId[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const hidden: BuiltinSourceId[] = [];
  for (const value of raw) {
    if (isBuiltinSourceId(value) && !hidden.includes(value)) {
      hidden.push(value);
    }
  }
  return normalizeOrder(hidden);
}

/**
 * 来源是否参与展示。缺省（没有这个 id）即开启——默认全开，
 * 与快照里“只记隐藏项”的存储形状一致。
 */
export function isBuiltinSourceEnabled(
  hidden: readonly BuiltinSourceId[],
  id: BuiltinSourceId,
): boolean {
  return !hidden.includes(id);
}

/** 显示 / 隐藏一个来源；返回按目录顺序规范化的新列表，便于直接落盘。 */
export function toggleBuiltinSource(
  hidden: readonly BuiltinSourceId[],
  id: BuiltinSourceId,
  enabled: boolean,
): BuiltinSourceId[] {
  const next = hidden.filter((candidate) => candidate !== id);
  if (!enabled) {
    next.push(id);
  }
  return normalizeOrder(next);
}

/** 按目录顺序排列：同一组开关只有一种快照写法（与关注球队同一口径）。 */
function normalizeOrder(hidden: readonly BuiltinSourceId[]): BuiltinSourceId[] {
  return BUILTIN_SOURCES.map((source) => source.id).filter((id) =>
    hidden.includes(id),
  );
}
