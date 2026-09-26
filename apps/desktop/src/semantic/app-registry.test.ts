// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../data/model";
import { normalizeEventTitle } from "../normalize/title";
import { createAppSemanticStack } from "./app-registry";

/**
 * 应用语义栈（SC-009 框架 + SC-014 / SC-015 接线）。
 *
 * 领域 Matcher 只在 app-registry 里静态注册一次：如果它掉出注册表，
 * 应用会静默退回“全部按普通事件显示”，各模块的单测却依然全绿。
 * 因此这里断言应用真正装配出来的那一套，而不是各自的构造器。
 */

function eventWithTitle(title: string): NormalizedEvent {
  return {
    uid: "match-1",
    sourceId: "src-1",
    title,
    normalizedTitle: normalizeEventTitle(title),
    start: "2026-10-18T16:30:00Z",
    allDay: false,
  };
}

describe("应用语义栈：识别 → 元数据（SC-014 + SC-015）", () => {
  it("英超比赛标题得到 sport.fixture 语义与双方展示载荷", () => {
    const stack = createAppSemanticStack();
    const event = eventWithTitle("Premier League: Manchester City @ Arsenal");

    const result = stack.engine.match(event);
    expect(result).toMatchObject({
      matcherId: "football.fixture-title",
      semantic: {
        type: "sport.fixture",
        subtype: "premier-league",
        // 主客顺序：`@` 右侧为主队。
        entities: [
          { type: "team", id: "arsenal" },
          { type: "team", id: "manchester-city" },
        ],
      },
    });

    const metadata =
      result === null
        ? undefined
        : stack.resolver?.resolve(result.semantic, event);
    expect(metadata?.label).toBe("英超");
    expect(metadata?.fixture?.teams.map((team) => team.nameZh)).toEqual([
      "阿森纳",
      "曼城",
    ]);
  });

  it("普通事件不进入增强（SEM-003）", () => {
    const stack = createAppSemanticStack();
    expect(stack.engine.match(eventWithTitle("Team meeting"))).toBeNull();
  });
});
