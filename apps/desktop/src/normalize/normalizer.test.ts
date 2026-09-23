import { describe, expect, it } from "vitest";
import { normalizeEventForStorage } from "./normalizer";
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
