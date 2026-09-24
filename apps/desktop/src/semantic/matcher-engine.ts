import type {
  NormalizedEvent,
  SemanticEntity,
  SemanticEvent,
  SemanticEventType,
} from "../data/model";
import { assertUniqueIds } from "./unique-ids";

/**
 * Matcher Engine（SC-009 / SEM-001 / SEM-002，app-spec §7.4）。
 *
 * 职责边界：只回答“这是什么”，不决定“怎么展示”
 * （展示归 Metadata Resolver），也不修改事件本身。
 * 领域 Matcher（节假日 SC-011、节日 / 节气 SC-012、英超 SC-015）
 * 通过静态注册进入引擎，UI 永远不接触标题判断。
 */

/** Matcher 的判定输出：只描述语义，身份字段（matcherId）由引擎盖戳。 */
export interface MatchOutput {
  type: SemanticEventType;
  subtype?: string;
  entities?: SemanticEntity[];
  /** 0–1 置信度；确定性判定可省略。 */
  confidence?: number;
  /** 人类可读的判定依据，供诊断与可解释状态（app-spec §14）。 */
  reason?: string;
}

/** SEM-002 MatchResult：引擎对外的完整判定，含溯源信息。 */
export interface MatchResult {
  /** 识别出的语义；matcherId / confidence 已由引擎写入。 */
  semantic: SemanticEvent;
  matcherId: string;
  confidence?: number;
  reason?: string;
}

export interface EventMatcher {
  /** 注册表内的稳定标识；重复 id 视为装配错误，直接抛错。 */
  id: string;
  /** 数值越小越先执行；同优先级按 id 字典序补齐，顺序完全确定。 */
  priority: number;
  /** 返回 null 表示不命中；抛错按“该 Matcher 失败”隔离，不影响事件。 */
  match(event: NormalizedEvent): MatchOutput | null;
}

/** 错误报告只含 Matcher 身份与事件持久化身份，不含事件正文（§14）。 */
export interface MatcherErrorReport {
  matcherId: string;
  sourceId: string;
  uid: string;
  error: unknown;
}

export interface MatcherEngineHooks {
  onMatcherError?: (report: MatcherErrorReport) => void;
}

export interface MatcherEngine {
  /**
   * 按确定顺序执行 Matcher，首个命中即返回；
   * 全部未命中（或全部失败）返回 null，调用方按普通事件显示（SEM-003）。
   */
  match(event: NormalizedEvent): MatchResult | null;
  /** 实际执行顺序（priority 升序、同级按 id 字典序），供测试与诊断。 */
  readonly order: readonly string[];
}

export function createMatcherEngine(
  matchers: readonly EventMatcher[],
  hooks: MatcherEngineHooks = {},
): MatcherEngine {
  const ordered = [...matchers].sort(
    (a, b) =>
      a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  assertUniqueIds(ordered, "Matcher");

  return {
    order: ordered.map((matcher) => matcher.id),
    match(event) {
      for (const matcher of ordered) {
        let output: MatchOutput | null;
        try {
          output = matcher.match(event);
        } catch (error) {
          // Matcher 失败只降级该 Matcher，事件继续走后续判定，
          // 无论如何不能让事件消失（app-spec §6）。
          hooks.onMatcherError?.({
            matcherId: matcher.id,
            sourceId: event.sourceId,
            uid: event.uid,
            error,
          });
          continue;
        }
        if (output === null) {
          continue;
        }
        return toResult(matcher.id, output);
      }
      return null;
    },
  };
}

function toResult(matcherId: string, output: MatchOutput): MatchResult {
  const semantic: SemanticEvent = { type: output.type, matcherId };
  const result: MatchResult = { semantic, matcherId };
  if (output.subtype !== undefined) {
    semantic.subtype = output.subtype;
  }
  if (output.entities !== undefined) {
    semantic.entities = output.entities;
  }
  if (output.confidence !== undefined) {
    semantic.confidence = output.confidence;
    result.confidence = output.confidence;
  }
  if (output.reason !== undefined) {
    result.reason = output.reason;
  }
  return result;
}
