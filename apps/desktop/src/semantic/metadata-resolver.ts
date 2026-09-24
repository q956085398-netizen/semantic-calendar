import type {
  NormalizedEvent,
  SemanticEvent,
  SemanticEventType,
} from "../data/model";
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

/**
 * 展示元数据契约：全部可选，缺失字段按普通事件降级。
 * 带索引签名是因为它最终存进快照的 Record<string, unknown> 分区；
 * 允许哪些字段由 displayMetadataOf 在读取边界收窄。
 */
export interface EventDisplayMetadata {
  [field: string]: unknown;
  /** CSS 颜色表达式（通常为 var(--semantic-*)），由主题层最终解释。 */
  accent?: string;
  /** 语义类型的本地化短标签；具体节日 / 球队名称由 SC-012 / SC-014 提供。 */
  label?: string;
  /** 图标 / Logo 资源引用；SC-014 起由 Provider 填充。 */
  iconRef?: string;
  reminder?: ReminderPolicy;
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

export interface ResolverErrorReport {
  resolverId: string;
  error: unknown;
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
          hooks.onResolverError?.({ resolverId: resolver.id, error });
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
  "sport.fixture": {
    accent: "var(--semantic-sport)",
    label: "体育赛事",
    reminder: { kind: "minutes-before-start", minutes: 30 },
  },
};

/**
 * 内置类型级 Resolver：只按 SemanticEvent.type 给默认值，
 * 不包含任何球队 / 节日条目知识（那些属于 SC-012 / SC-014 的 Provider）。
 * calendar.event 无增强，返回 null 走普通显示。
 */
export function createBuiltinTypeMetadataResolver(): MetadataResolver {
  return {
    id: "builtin.semantic-type",
    resolve(semantic) {
      const defaults = TYPE_DEFAULTS[semantic.type];
      return defaults ? { ...defaults } : null;
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
  return narrowed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
