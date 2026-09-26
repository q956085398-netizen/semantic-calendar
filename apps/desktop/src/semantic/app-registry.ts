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
 * 运行期不增删。优先级区间约定见 football-matcher.ts：0–99 留给按日期判定的
 * 事件语义，标题型语义用 100 起。
 *
 * 日级语义不走这里：法定节假日（SC-011）与节气 / 传统节日（SC-012）是日期
 * 本身的属性，不是某条事件的属性（同一天可以有任意多事件，也可以一个都没有），
 * 而引擎的输入是事件。它们与农历一样以日期键为入口
 * （semantic/app-china-days.ts），未注册的语义照常按普通事件显示（SEM-003）。
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
 * 这里把错误交给控制台留痕。
 *
 * 报告里的文案在生成处（引擎 / 解析链）就已脱敏——地址查询串与事件正文
 * 都已被替换，因此这里可以整体打印而不必再判断什么能写、什么不能写
 * （SC-019：日志不泄露完整私密事件或 URL token）。
 */
function reportMatcherError(report: MatcherErrorReport): void {
  console.warn(
    `[semantic] Matcher ${report.matcherId} 失败`,
    report.sourceId,
    report.uid,
    report.errorName,
    report.message,
  );
}

function reportResolverError(report: ResolverErrorReport): void {
  console.warn(
    `[semantic] MetadataResolver ${report.resolverId} 失败`,
    report.errorName,
    report.message,
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
