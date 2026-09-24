import type { SemanticEvent } from "../../data/model";
import {
  sportFixtureMetadataDefaults,
  type EventDisplayMetadata,
  type FixtureTeamDisplay,
  type MetadataResolver,
} from "../../semantic/metadata-resolver";
import { competitionDisplay } from "./competitions";
import type { FootballCatalog } from "./football-catalog";
import type { TeamMetadata } from "./teams";

/**
 * 足球赛事的 Metadata Resolver（SC-014 / app-spec §7.5）。
 *
 * 输入是 Matcher（SC-015）给出的语义：subtype 为联赛 ID，
 * entities 中 type === "team" 的条目为参赛球队。
 * 输出是展示载荷：联赛短标签与语义色、Logo 逻辑引用、双方展示信息与球队色。
 *
 * 降级规则（P-01 / P-03，SEM-003）：
 * - 非 sport.fixture：返回 null，交给后续 Resolver；
 * - 联赛未登记（如未来的欧冠）：返回 null，走内置默认值，
 *   不把“不认识”渲染成错误信息；
 * - 可解析球队不足两支：返回 null，按普通增强事件显示——
 *   “队标 VS 队标”少一侧就不成立（SPORT-004）；
 * - 个别球队未登记：只跳过该球队，只要还剩两支就照常展示。
 */

export const FOOTBALL_RESOLVER_ID = "football.fixture-metadata";

/** 一场比赛的两侧。多出来的实体按“不是这场比赛”处理，不参与展示。 */
const SIDES = 2;

export function createFootballMetadataResolver(
  catalog: FootballCatalog,
): MetadataResolver {
  return {
    id: FOOTBALL_RESOLVER_ID,
    resolve(semantic: SemanticEvent): EventDisplayMetadata | null {
      if (semantic.type !== "sport.fixture") {
        return null;
      }
      // 联赛 ID 走 subtype：这是 Matcher 与 Resolver 之间的既定接口。
      const competition = semantic.subtype
        ? catalog.competitionById(semantic.subtype)
        : undefined;
      if (competition === undefined) {
        return null;
      }
      const teams = fixtureTeams(catalog, semantic);
      if (teams.length < SIDES) {
        return null;
      }
      // 必须带上类型级默认值：解析链首个非 null 生效，
      // 这里返回后内置默认值不会再执行（见 sportFixtureMetadataDefaults）。
      // 联赛自己的语义色与短标签覆盖默认值——色值只有 competitions.ts 一处。
      return {
        ...sportFixtureMetadataDefaults(),
        accent: competition.accent,
        label: competition.label,
        fixture: {
          competition: competitionDisplay(competition),
          teams: teams.slice(0, SIDES),
        },
      };
    },
  };
}

/** 按语义实体顺序解析球队；重复与未登记的 id 只跳过，不中断。 */
export function fixtureTeams(
  catalog: FootballCatalog,
  semantic: SemanticEvent,
): FixtureTeamDisplay[] {
  const teams: FixtureTeamDisplay[] = [];
  const seen = new Set<string>();
  for (const entity of semantic.entities ?? []) {
    if (entity.type !== "team" || seen.has(entity.id)) {
      continue;
    }
    const team = catalog.teamById(entity.id);
    if (team === undefined) {
      continue;
    }
    seen.add(entity.id);
    teams.push(teamDisplay(team));
  }
  return teams;
}

/** 球队字典条目 → 展示信息：中文名优先展示，英文名并列（ui-design §13）。 */
export function teamDisplay(team: TeamMetadata): FixtureTeamDisplay {
  return {
    id: team.id,
    nameZh: team.nameZh,
    nameEn: team.name,
    code: team.code,
    crestRef: team.crestRef,
    colors: { ...team.colors },
  };
}
