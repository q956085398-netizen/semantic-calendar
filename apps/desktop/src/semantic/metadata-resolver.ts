import type {
  NormalizedEvent,
  SemanticEvent,
  SemanticEventType,
} from "../data/model";
import { describeEventError, type SanitizedError } from "../reliability/redact";
import { assertUniqueIds } from "./unique-ids";

/**
 * Metadata Resolver（SC-009 / app-spec §7.5，架构 §5）。
 *
 * 职责边界：只回答“怎么展示”（本地化名称、语义色、图标引用、
 * 默认提醒策略），不做识别——识别归 Matcher Engine。
 * 两者分离使图标包 / 主题 / 语言可以整体替换而不动识别逻辑。
 */

/** 默认提醒策略：建议值，最终由用户设置覆盖（SC-017 消费）。 */
export type ReminderPolicy =
  | { kind: "minutes-before-start"; minutes: number }
  | { kind: "same-morning" }
  | { kind: "previous-evening" };

/** 展示层颜色对：主色用于低透明度背景 / 强调条，副色用于对比元素。 */
export interface MarkColors {
  primary: string;
  secondary: string;
}

/**
 * 球队展示信息（SC-014 由 Provider 填充）。
 * 只含展示事实，不含任何识别判断；UI 直接渲染，不做球队名匹配。
 * 字段名与球队字典（TeamMetadata）保持一致：nameZh / nameEn 不会互换含义。
 */
export interface FixtureTeamDisplay {
  /** 稳定球队 ID，与 SemanticEvent.entities 中的 id 一致。 */
  id: string;
  /** 中文名。 */
  nameZh: string;
  /** 英文名。 */
  nameEn: string;
  /** 3 字母代码：队徽资源缺失时的 fallback 缩写（SPORT-001）。 */
  code: string;
  /** 队徽逻辑引用；缺省表示没有可用引用（渲染走 fallback）。 */
  crestRef?: string;
  colors: MarkColors;
}

/** 联赛展示信息（SC-014 由 Provider 填充）。 */
export interface FixtureCompetitionDisplay {
  id: string;
  /** 中文短标签（“英超”），用于月格徽标位与 Inspector 标题。 */
  label: string;
  /** 中文全称。 */
  nameZh: string;
  /** 英文名。 */
  nameEn: string;
  /** 联赛 Logo 逻辑引用；同样只是引用，资源由资源包提供。 */
  logoRef?: string;
  colors: MarkColors;
}

/** 比赛展示载荷：月格“队标 VS 队标”与 Matchday Inspector 的数据来源。 */
export interface FixtureDisplay {
  competition: FixtureCompetitionDisplay;
  /**
   * 固定两侧，顺序即主客队顺序（SPORT-003：home / away 由 SC-015 的
   * Matcher 决定，未知时按它给出的实体顺序）。少于两支球队不成一场比赛，
   * 因此载荷里不会出现只有一侧的对阵。
   */
  teams: readonly FixtureTeamDisplay[];
}

/**
 * 展示元数据契约：全部可选，缺失字段按普通事件降级。
 * 带索引签名是因为它最终存进快照的 Record<string, unknown> 分区；
 * 允许哪些字段由 displayMetadataOf 在读取边界收窄。
 *
 * 契约（形状）在核心，内容（球队 / 联赛条目）在 Provider：
 * 这与 SemanticEvent.type 已包含 "sport.fixture" 是同一条边界——
 * 核心描述语义与展示的“格子”，领域知识全部来自注册表。
 */
export interface EventDisplayMetadata {
  [field: string]: unknown;
  /** CSS 颜色表达式（通常为 var(--semantic-*)），由主题层最终解释。 */
  accent?: string;
  /** 语义类型的本地化短标签；具体节日 / 球队名称由 SC-012 / SC-014 提供。 */
  label?: string;
  /**
   * 图标资源引用：给「挂在事件上的语义」用，当前没有 Provider 填充
   * （足球赛事的联赛 Logo 走 fixture.competition.logoRef，不在这里重复）。
   * 日级语义（传统节日 / 节气 SC-012）不挂事件，因此它们的背景引用走日级载荷
   * ——semantic/app-china-festivals.ts 的 backgroundRef 与 semantic/day-backdrop.ts。
   */
  iconRef?: string;
  reminder?: ReminderPolicy;
  /** 仅 sport.fixture：对阵双方的完整展示载荷（SC-014）。 */
  fixture?: FixtureDisplay;
}

export interface MetadataResolver {
  id: string;
  /**
   * 返回该语义的展示元数据；返回 null 表示不处理，
   * 交给组合器中的后续 Resolver。
   */
  resolve(
    semantic: SemanticEvent,
    event: NormalizedEvent,
  ): EventDisplayMetadata | null;
}

export interface ResolverErrorReport extends SanitizedError {
  resolverId: string;
}

export interface MetadataResolverHooks {
  onResolverError?: (report: ResolverErrorReport) => void;
}

export interface MetadataResolverStack {
  /** 按注册顺序取第一个非 null；全部失败 / 未命中返回 null。 */
  resolve(
    semantic: SemanticEvent,
    event: NormalizedEvent,
  ): EventDisplayMetadata | null;
  /** 实际生效顺序（注册顺序），供测试与诊断。 */
  readonly order: readonly string[];
}

export function createMetadataResolver(
  resolvers: readonly MetadataResolver[],
  hooks: MetadataResolverHooks = {},
): MetadataResolverStack {
  const ordered = [...resolvers];
  assertUniqueIds(ordered, "MetadataResolver");
  return {
    order: ordered.map((resolver) => resolver.id),
    resolve(semantic, event) {
      for (const resolver of ordered) {
        let metadata: EventDisplayMetadata | null;
        try {
          metadata = resolver.resolve(semantic, event);
        } catch (error) {
          // Resolver 失败只降级展示元数据，绝不能让事件消失（app-spec §6）。
          // 脱敏在这里做：只有这里同时持有异常与事件（SC-019 / §14）。
          hooks.onResolverError?.({
            resolverId: resolver.id,
            ...describeEventError(error, event),
          });
          continue;
        }
        if (metadata !== null) {
          return metadata;
        }
      }
      return null;
    },
  };
}

/** 类型级默认元数据：语义色 token、中文短标签与默认提醒（架构 §7）。 */
interface TypeDefaults {
  accent: string;
  label: string;
  reminder: ReminderPolicy;
}

/** 体育赛事默认值的字面量：默认 Resolver 与 Provider 共用一个来源，避免漂移。 */
/** 体育赛事默认值的唯一来源：内置 Resolver 与 Provider 都从这里取。 */
const SPORT_FIXTURE_DEFAULTS: TypeDefaults = {
  accent: "var(--semantic-sport)",
  label: "体育赛事",
  reminder: { kind: "minutes-before-start", minutes: 30 },
};

const TYPE_DEFAULTS: Partial<Record<SemanticEventType, TypeDefaults>> = {
  holiday: {
    accent: "var(--semantic-holiday)",
    label: "法定节假日",
    reminder: { kind: "same-morning" },
  },
  "makeup-workday": {
    accent: "var(--semantic-makeup-workday)",
    label: "补班日",
    reminder: { kind: "same-morning" },
  },
  festival: {
    accent: "var(--semantic-festival)",
    label: "传统节日",
    reminder: { kind: "previous-evening" },
  },
  "solar-term": {
    accent: "var(--semantic-solar-term)",
    label: "节气",
    reminder: { kind: "same-morning" },
  },
  "sport.fixture": SPORT_FIXTURE_DEFAULTS,
};

/**
 * 体育赛事的类型级默认元数据副本。
 *
 * Provider（SC-014+）的 Resolver 注册在默认值之前，而解析链按
 * “首个非 null 生效”，所以 Provider 返回的元数据必须自己带上默认值，
 * 否则会丢掉默认提醒策略。每次返回全新对象（含 reminder），
 * 调用方可以安全改写而不影响内置默认值。
 */
export function sportFixtureMetadataDefaults(): EventDisplayMetadata {
  return {
    accent: SPORT_FIXTURE_DEFAULTS.accent,
    label: SPORT_FIXTURE_DEFAULTS.label,
    reminder: cloneReminder(SPORT_FIXTURE_DEFAULTS.reminder),
  };
}

/**
 * 任意类型的类型级默认元数据副本；未登记的类型返回 null。
 *
 * 日级语义（SC-011 的休假 / 补班，SC-012 的节日 / 节气）没有事件可以挂，
 * 因此不走解析链，但语义色仍然只有这里一处——展示层（含日级载荷）都从这里取，
 * 日级展示不会长出第二套色板。同样每次返回全新对象。
 */
export function semanticTypeDefaults(
  type: SemanticEventType,
): EventDisplayMetadata | null {
  const defaults = TYPE_DEFAULTS[type];
  return defaults
    ? { ...defaults, reminder: cloneReminder(defaults.reminder) }
    : null;
}

function cloneReminder(policy: ReminderPolicy): ReminderPolicy {
  return policy.kind === "minutes-before-start"
    ? { kind: "minutes-before-start", minutes: policy.minutes }
    : { kind: policy.kind };
}

/**
 * 内置类型级 Resolver：只按 SemanticEvent.type 给默认值，
 * 不包含任何球队 / 节日条目知识（那些属于 SC-012 / SC-014 的 Provider）。
 * calendar.event 无增强，返回 null 走普通显示。
 */
export function createBuiltinTypeMetadataResolver(): MetadataResolver {
  return {
    id: "builtin.semantic-type",
    resolve(semantic) {
      return semanticTypeDefaults(semantic.type);
    },
  };
}

/**
 * 读取边界收窄：metadata 来自磁盘 JSON（unknown），
 * UI 消费前在这里防御性校验，畸形字段丢弃而不是抛错。
 */
export function displayMetadataOf(event: {
  metadata?: unknown;
}): EventDisplayMetadata | undefined {
  const metadata = event.metadata;
  if (metadata === undefined || !isPlainObject(metadata)) {
    return undefined;
  }
  const narrowed: EventDisplayMetadata = {};
  if (typeof metadata.accent === "string") {
    narrowed.accent = metadata.accent;
  }
  if (typeof metadata.label === "string") {
    narrowed.label = metadata.label;
  }
  if (typeof metadata.iconRef === "string") {
    narrowed.iconRef = metadata.iconRef;
  }
  const reminder = metadata.reminder;
  if (isPlainObject(reminder) && typeof reminder.kind === "string") {
    if (
      reminder.kind === "same-morning" ||
      reminder.kind === "previous-evening"
    ) {
      narrowed.reminder = { kind: reminder.kind };
    } else if (
      reminder.kind === "minutes-before-start" &&
      typeof reminder.minutes === "number" &&
      Number.isFinite(reminder.minutes)
    ) {
      narrowed.reminder = {
        kind: "minutes-before-start",
        minutes: reminder.minutes,
      };
    }
  }
  const fixture = narrowFixture(metadata.fixture);
  if (fixture) {
    narrowed.fixture = fixture;
  }
  return narrowed;
}

/** 颜色对：两个字段都必须是字符串才采用，否则整块丢弃（不猜默认值）。 */
function narrowColors(value: unknown): MarkColors | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const { primary, secondary } = value;
  if (typeof primary !== "string" || typeof secondary !== "string") {
    return undefined;
  }
  return { primary, secondary };
}

function narrowFixtureTeam(value: unknown): FixtureTeamDisplay | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const { id, nameZh, nameEn, code, crestRef } = value;
  if (
    typeof id !== "string" ||
    typeof nameZh !== "string" ||
    typeof nameEn !== "string" ||
    typeof code !== "string"
  ) {
    return undefined;
  }
  const colors = narrowColors(value.colors);
  if (!colors) {
    return undefined;
  }
  return {
    id,
    nameZh,
    nameEn,
    code,
    colors,
    ...(typeof crestRef === "string" ? { crestRef } : {}),
  };
}

function narrowCompetition(
  value: unknown,
): FixtureCompetitionDisplay | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const { id, label, nameZh, nameEn, logoRef } = value;
  if (
    typeof id !== "string" ||
    typeof label !== "string" ||
    typeof nameZh !== "string" ||
    typeof nameEn !== "string"
  ) {
    return undefined;
  }
  const colors = narrowColors(value.colors);
  if (!colors) {
    return undefined;
  }
  return {
    id,
    label,
    nameZh,
    nameEn,
    colors,
    ...(typeof logoRef === "string" ? { logoRef } : {}),
  };
}

/**
 * 比赛载荷收窄：比赛必须有联赛、且两侧都能渲染（SPORT-004 的
 * “队标 VS 队标”少一侧就不成立），否则返回 undefined——
 * 调用方按普通增强事件显示，而不是渲染半张卡片。
 */
function narrowFixture(value: unknown): FixtureDisplay | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const competition = narrowCompetition(value.competition);
  if (!competition || !Array.isArray(value.teams)) {
    return undefined;
  }
  const teams: FixtureTeamDisplay[] = [];
  for (const entry of value.teams) {
    const team = narrowFixtureTeam(entry);
    if (team) {
      teams.push(team);
    }
  }
  if (teams.length < 2) {
    return undefined;
  }
  return { competition, teams };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
