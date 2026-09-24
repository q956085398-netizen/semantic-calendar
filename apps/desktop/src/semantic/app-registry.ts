import {
  createMatcherEngine,
  type EventMatcher,
  type MatcherErrorReport,
} from "./matcher-engine";
import {
  createBuiltinTypeMetadataResolver,
  createMetadataResolver,
  type MetadataResolver,
  type ResolverErrorReport,
} from "./metadata-resolver";
import type { SemanticStack } from "./enrich";

/**
 * 应用级静态注册（SC-009 / SEM-001）。
 *
 * Matcher 集合在装配期固定、顺序由引擎确定，运行期不增删。
 * 具体领域 Matcher 由后续 Ticket 加入：
 * - 法定节假日 / 补班：SC-011
 * - 传统节日与二十四节气：SC-012
 * - 英超球队元数据：SC-014；比赛标题 Matcher：SC-015
 * 集合为空时所有事件按普通事件显示（SEM-003），链路照常执行。
 */

const APP_MATCHERS: readonly EventMatcher[] = [];

/** 元数据解析链：自定义 Provider（SC-014+）注册在内置默认值之前。 */
const APP_METADATA_RESOLVERS: readonly MetadataResolver[] = [
  createBuiltinTypeMetadataResolver(),
];

/**
 * 失败可观测（app-spec §6 / §14）：Matcher / Resolver 抛错只降级自身，
 * 这里把错误交给控制台留痕。报告只含注册项 id 与事件持久化身份
 * （sourceId / uid），不含事件正文。
 */
function reportMatcherError(report: MatcherErrorReport): void {
  console.warn(
    `[semantic] Matcher ${report.matcherId} 失败`,
    report.sourceId,
    report.uid,
    report.error instanceof Error ? report.error.message : report.error,
  );
}

function reportResolverError(report: ResolverErrorReport): void {
  console.warn(
    `[semantic] MetadataResolver ${report.resolverId} 失败`,
    report.error instanceof Error ? report.error.message : report.error,
  );
}

export function createAppSemanticStack(): SemanticStack {
  return {
    engine: createMatcherEngine(APP_MATCHERS, {
      onMatcherError: reportMatcherError,
    }),
    resolver: createMetadataResolver(APP_METADATA_RESOLVERS, {
      onResolverError: reportResolverError,
    }),
  };
}
