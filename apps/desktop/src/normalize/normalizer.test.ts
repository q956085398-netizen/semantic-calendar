import { describe, expect, it } from "vitest";
import {
  normalizeEventForStorage,
  normalizeEventsForStorage,
  normalizeEventsInChunks,
} from "./normalizer";
import type { RawCalendarEvent } from "../data/model";

/**
 * SC-008 / app-spec §7.3：入库前的标准化。
 *
 * 持久化策略（SC-003 的 StoredEvent 设计）：原始字段原样保留，
 * 附加可重建的标准化字段（normalizedTitle / timezone）；
 * 换算后的 UTC 瞬时不落库——occurrence 展开在读取路径按需计算。
 */

function makeRaw(partial: Partial<RawCalendarEvent>): RawCalendarEvent {
  return {
    uid: "event@example.com",
    sourceId: "local-ics:test",
    title: "测试事件",
    start: "2026-10-01T09:00:00",
    allDay: false,
    ...partial,
  };
}

describe("normalizeEventForStorage", () => {
  it("附加 normalizedTitle 并完整保留原始字段", () => {
    const raw = makeRaw({
      title: "  Ａｒｓｅｎａｌ　ｖｓ　Ｍａｎｃｈｅｓｔｅｒ Ｃｉｔｙ  ",
      description: "desc",
      location: "Emirates Stadium",
      rawPayload: "BEGIN:VEVENT…",
    });

    const stored = normalizeEventForStorage(raw);

    expect(stored).toEqual({
      ...raw,
      normalizedTitle: "Arsenal vs Manchester City",
    });
  });

  it("timezone：TZID 事件记录 IANA 名，UTC 记录 UTC，浮动 / 全天缺省", () => {
    expect(
      normalizeEventForStorage(
        makeRaw({
          start: "2026-10-18T15:00:00",
          startTzid: "Europe/London",
        }),
      ).timezone,
    ).toBe("Europe/London");

    expect(
      normalizeEventForStorage(makeRaw({ start: "2026-10-18T15:00:00.000Z" }))
        .timezone,
    ).toBe("UTC");

    expect(normalizeEventForStorage(makeRaw({})).timezone).toBeUndefined();
    expect(
      normalizeEventForStorage(makeRaw({ start: "2026-10-18", allDay: true }))
        .timezone,
    ).toBeUndefined();
  });

  it("幂等：标准化结果再标准化不变", () => {
    const once = normalizeEventForStorage(makeRaw({ title: "  周　会 " }));
    expect(normalizeEventForStorage(once)).toEqual(once);
  });
});

/**
 * SC-024 / app-spec §15：分片标准化。
 *
 * 解析与落库各自分片之后，中间这一趟很容易被漏掉：10,000 条的事件标准化
 * 约 15 ms，正好是一帧。这里钉住「分片不改变结果，也不改变来源归属」。
 */
describe("normalizeEventsInChunks — 分片标准化（SC-024）", () => {
  /** 解析产物的形状：没有 sourceId（由调用方回填）。 */
  function parsedEvents(): Omit<RawCalendarEvent, "sourceId">[] {
    const strip = ({ sourceId, ...rest }: RawCalendarEvent) => {
      void sourceId;
      return rest;
    };
    return [
      makeRaw({
        title: " Ａｒｓｅｎａｌ　ｖｓ　Ｍａｎｃｈｅｓｔｅｒ Ｃｉｔｙ ",
      }),
      makeRaw({
        uid: "tzid@example.com",
        start: "2026-10-18T15:00:00",
        startTzid: "Europe/London",
      }),
      makeRaw({ uid: "utc@example.com", start: "2026-10-18T15:00:00.000Z" }),
      makeRaw({ uid: "allday@example.com", start: "2026-10-18", allDay: true }),
      makeRaw({ uid: "orphan@example.com" }),
    ].map(strip);
  }

  function drain(chunkEvents: number) {
    const steps = normalizeEventsInChunks(
      parsedEvents(),
      "webcal:订阅",
      chunkEvents,
    );
    let yields = 0;
    let step = steps.next();
    while (!step.done) {
      yields += 1;
      step = steps.next();
    }
    return { result: step.value, yields };
  }

  it("结果与同步入口逐条相同（不同粒度下都是同一份结果）", () => {
    const expected = normalizeEventsForStorage(parsedEvents(), "webcal:订阅");
    expect(expected).toHaveLength(5);

    for (const chunkEvents of [1, 2, 1000]) {
      expect(drain(chunkEvents).result).toEqual(expected);
    }
  });

  it("来源以调用方声明为准：原事件里的 sourceId 被覆盖", () => {
    expect(
      drain(2).result.every((event) => event.sourceId === "webcal:订阅"),
    ).toBe(true);
  });

  it("分片粒度为 0 时中间不让出：一次 next 就结束", () => {
    const steps = normalizeEventsInChunks(parsedEvents(), "local-ics:t", 0);
    const first = steps.next();

    expect(first.done).toBe(true);
    expect(first.value).toEqual(
      normalizeEventsForStorage(parsedEvents(), "local-ics:t"),
    );
  });

  it("空输入不产生让出点", () => {
    const steps = normalizeEventsInChunks([], "local-ics:t", 1);
    expect(steps.next().done).toBe(true);
  });
});
