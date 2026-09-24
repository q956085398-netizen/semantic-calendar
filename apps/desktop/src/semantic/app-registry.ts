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
import { footballCatalog } from "../providers/football/football-catalog";
import { createFootballMatcher } from "../providers/football/football-matcher";
import { createFootballMetadataResolver } from "../providers/football/football-metadata-resolver";

/**
 * 应用级静态注册（SC-009 / SEM-001）。
 *
 * Matcher 集合在装配期固定、顺序由引擎确定（priority 升序、同级按 id 字典序），
 * 运行期不增删。优先级区间约定见 football-matcher.ts：按日期判定的语义
 * （法定节假日 SC-011、传统节日与节气 SC-012）用 0–99，标题型语义用 100 起。
 * 尚未注册的领域让事件按普通事件显示（SEM-003），链路照常执行。
 */

const APP_MATCHERS: readonly EventMatcher[] = [
  createFootballMatcher(footballCatalog),
];

/**
 * 元数据解析链：自定义 Provider（SC-014+）注册在内置默认值之前。
 * 顺序有意义——解析链首个非 null 生效，所以 Provider 必须自己带上
 * 类型级默认值（sportFixtureMetadataDefaults），否则会丢掉默认提醒策略。
 */
const APP_METADATA_RESOLVERS: readonly MetadataResolver[] = [
  createFootballMetadataResolver(footballCatalog),
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
