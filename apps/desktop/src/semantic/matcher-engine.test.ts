import { describe, expect, it, vi } from "vitest";
import type { NormalizedEvent } from "../data/model";
import {
  createMatcherEngine,
  type EventMatcher,
  type MatchOutput,
  type MatcherErrorReport,
} from "./matcher-engine";

/** 构造最小可匹配事件；Matcher 只应依赖标准化后的字段。uid 与正文无关。 */
function event(title: string): NormalizedEvent {
  return {
    uid: "uid-test",
    sourceId: "src",
    title,
    normalizedTitle: title,
    start: "2026-10-01T00:00:00.000Z",
    allDay: true,
  };
}

/** 测试用 Matcher：按标题子串命中并输出给定语义。 */
function matcher(
  id: string,
  priority: number,
  when: (title: string) => boolean,
  output: MatchOutput | null = null,
): EventMatcher {
  return {
    id,
    priority,
    match: (candidate) =>
      when(candidate.normalizedTitle)
        ? (output ?? {
            type: "holiday",
            confidence: 1,
            reason: `${id} 命中`,
          })
        : null,
  };
}

describe("SEM-001 静态注册与确定顺序", () => {
  it("按 priority 升序执行，同优先级按 id 字典序补齐", () => {
    const engine = createMatcherEngine([
      matcher("zeta", 20, () => false),
      matcher("beta", 10, () => false),
      matcher("alpha", 20, () => false),
      matcher("gamma", 10, () => false),
    ]);
    expect(engine.order).toEqual(["beta", "gamma", "alpha", "zeta"]);
  });

  it("重复的 matcher id 在装配期直接失败", () => {
    expect(() =>
      createMatcherEngine([
        matcher("dupe", 1, () => false),
        matcher("dupe", 2, () => false),
      ]),
    ).toThrow(/dupe/);
  });

  it("注册顺序不影响执行顺序（集合语义）", () => {
    const a = [matcher("a", 1, () => false), matcher("b", 2, () => false)];
    const b = [matcher("b", 2, () => false), matcher("a", 1, () => false)];
    expect(createMatcherEngine(a).order).toEqual(["a", "b"]);
    expect(createMatcherEngine(b).order).toEqual(["a", "b"]);
  });
});

describe("SEM-002 MatchResult", () => {
  it("首个命中的 Matcher 胜出，后续不再执行", () => {
    const laterMatch = vi.fn((): MatchOutput => ({ type: "festival" }));
    const engine = createMatcherEngine([
      { id: "high-priority", priority: 1, match: () => ({ type: "holiday" }) },
      { id: "low-priority", priority: 2, match: laterMatch },
    ]);

    const result = engine.match(event("任何标题"));

    expect(result?.matcherId).toBe("high-priority");
    expect(result?.semantic.type).toBe("holiday");
    expect(laterMatch).not.toHaveBeenCalled();
  });

  it("matcherId 由引擎盖戳进 semantic 与结果，语义可追溯", () => {
    const engine = createMatcherEngine([
      matcher("cn-holiday", 1, () => true, {
        type: "holiday",
        subtype: "national",
        entities: [{ type: "region", id: "cn" }],
        confidence: 0.9,
        reason: "标题命中法定节假日表",
      }),
    ]);

    const result = engine.match(event("国庆假期"));

    expect(result).toEqual({
      matcherId: "cn-holiday",
      confidence: 0.9,
      reason: "标题命中法定节假日表",
      semantic: {
        type: "holiday",
        subtype: "national",
        entities: [{ type: "region", id: "cn" }],
        confidence: 0.9,
        matcherId: "cn-holiday",
      },
    });
  });

  it("可选字段缺失时保持轻量输出", () => {
    const engine = createMatcherEngine([
      matcher("bare", 1, () => true, { type: "solar-term" }),
    ]);

    expect(engine.match(event("寒露"))).toEqual({
      matcherId: "bare",
      semantic: { type: "solar-term", matcherId: "bare" },
    });
  });
});

describe("SEM-003 未命中回退", () => {
  it("全部未命中返回 null，由调用方按普通事件显示", () => {
    const engine = createMatcherEngine([
      matcher("a", 1, (title) => title === "不存在"),
      matcher("b", 2, () => false),
    ]);
    expect(engine.match(event("普通会议"))).toBeNull();
  });

  it("空注册表等价于全部普通事件", () => {
    expect(createMatcherEngine([]).match(event("任意"))).toBeNull();
    expect(createMatcherEngine([]).order).toEqual([]);
  });
});

describe("Matcher 失败隔离（app-spec §6 Matcher 失败）", () => {
  it("抛错的 Matcher 被跳过，事件继续交给后续 Matcher，不会消失", () => {
    const onMatcherError = vi.fn();
    const exploding: EventMatcher = {
      id: "exploding",
      priority: 1,
      match: () => {
        throw new Error("matcher 内部错误");
      },
    };
    const fallback = matcher("fallback", 2, () => true, { type: "festival" });
    const engine = createMatcherEngine([fallback, exploding], {
      onMatcherError,
    });

    const result = engine.match(event("某事件"));

    expect(result?.matcherId).toBe("fallback");
    expect(onMatcherError).toHaveBeenCalledTimes(1);
    expect(onMatcherError).toHaveBeenCalledWith(
      expect.objectContaining({
        matcherId: "exploding",
        sourceId: "src",
        uid: "uid-test",
      }),
    );
  });

  it("错误报告只带洗过的文案，原始异常不出报告（app-spec §14 / SC-019）", () => {
    const reports: unknown[] = [];
    const engine = createMatcherEngine(
      [
        {
          id: "boom",
          priority: 1,
          match: () => {
            throw new Error("x");
          },
        },
      ],
      { onMatcherError: (report) => reports.push(report) },
    );

    engine.match(event("机密标题"));

    expect(reports).toHaveLength(1);
    expect(JSON.stringify(reports[0])).not.toContain("机密标题");
    // 报告里没有 error 字段：日志侧无法“顺手取一下 message”。
    // （只断言字符串包含是不足以证明这一点的——Error 的 message 不可枚举，
    //  JSON.stringify 本来就不打印它。）
    expect(reports[0]).not.toHaveProperty("error");
  });

  it("把标题与地址拼进 message 的 Matcher 也泄露不了正文（SC-019）", () => {
    const reports: MatcherErrorReport[] = [];
    const secretUrl = "https://calendar.example.com/feed.ics?token=SECRET";
    const engine = createMatcherEngine(
      [
        {
          id: "boom",
          priority: 1,
          match: (candidate) => {
            // 最坏情况：实现方把事件正文与地址一起拼进异常文案。
            throw new TypeError(
              `无法解析「${candidate.normalizedTitle}」：${secretUrl}`,
            );
          },
        },
      ],
      { onMatcherError: (report) => reports.push(report) },
    );

    engine.match(event("机密标题"));

    expect(reports[0].errorName).toBe("TypeError");
    expect(reports[0].message).not.toContain("机密标题");
    expect(reports[0].message).not.toContain("SECRET");
    expect(reports[0].message).toContain("无法解析");
  });
});
