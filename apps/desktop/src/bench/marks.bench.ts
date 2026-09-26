// @vitest-environment node
/**
 * 基线：队徽 / 联赛 Logo 解析（app-spec §15「Logo / 图片缓存效果」）。
 *
 * v0.1 不随仓库分发任何图片（开发原则 §10 版权边界），资源包缺省为空，
 * 因此这里量的是 fallback 路径的解析开销——它是月格每次渲染都要走的
 * 那一段。图片本身的缓存不在应用里：一旦装入资源包，命中的是 WebView
 * 自己的图片缓存（同 URL 不重复下载），应用不再叠一层。
 */

import { bench, describe } from "vitest";
import { asNormalizedEvent } from "../data/model";
import { createAppSemanticStack } from "../semantic/app-registry";
import {
  displayMetadataOf,
  type FixtureDisplay,
} from "../semantic/metadata-resolver";
import { resolveCompetitionMark, resolveTeamMark } from "../semantic/marks";
import { buildStoredEvents } from "./fixtures";

/** 一屏月格的格子数（6 周 × 7 天）。 */
const CELLS = 42;

const fixture = fixtureDisplayOf();
const [home, away] = fixture.teams;

describe("月格标记解析 · 空资源包（fallback）", () => {
  bench(
    `一屏 ${CELLS} 格 × 双方队徽 + 联赛 Logo`,
    () => {
      for (let cell = 0; cell < CELLS; cell += 1) {
        resolveTeamMark(home);
        resolveTeamMark(away);
        resolveCompetitionMark(fixture.competition);
      }
    },
    { iterations: 10, warmupIterations: 1, time: 0 },
  );
});

/** 真实链路里的一份比赛展示载荷：走引擎 + Resolver 得到，而不是手搓对象。 */
function fixtureDisplayOf(): FixtureDisplay {
  const stack = createAppSemanticStack();
  for (const stored of buildStoredEvents(200)) {
    const event = asNormalizedEvent(stored);
    const match = stack.engine.match(event);
    const display = match
      ? stack.resolver?.resolve(match.semantic, event)
      : null;
    const fixture =
      display == null
        ? undefined
        : displayMetadataOf({ metadata: display })?.fixture;
    if (fixture !== undefined) {
      return fixture;
    }
  }
  throw new Error("夹具没有产出比赛展示载荷，基准无法运行");
}
