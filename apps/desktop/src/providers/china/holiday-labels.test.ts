import { describe, expect, it } from "vitest";
import {
  MAKEUP_GLYPH,
  REST_GLYPH,
  chinaDayGlyph,
  chinaDayLabelText,
  chinaDayPositionText,
  holidayNamesText,
} from "./holiday-labels";
import { chinaHolidays, type ChinaHolidayDay } from "./holidays";

/**
 * 节假日文本测试（SC-011 / ui-design §7.2、§8.2）。
 *
 * 文本规则单独一层：大字用字、假期名连接方式、连休位置文案都在这里定，
 * 查询层只给事实。补班与休假必须是两套写法，否则 UI 只能靠颜色区分（§24）。
 */

function dayOf(dateKey: string): ChinaHolidayDay {
  const day = chinaHolidays.chinaHolidayOfKey(dateKey);
  if (!day) {
    throw new Error(`测试日期不是假期：${dateKey}`);
  }
  return day;
}

describe("节假日文本（SC-011）", () => {
  it("大字：休假「休」、补班「补」", () => {
    expect(chinaDayGlyph("rest")).toBe(REST_GLYPH);
    expect(chinaDayGlyph("makeup")).toBe(MAKEUP_GLYPH);
    expect([REST_GLYPH, MAKEUP_GLYPH]).toEqual(["休", "补"]);
  });

  it("假期名按通知原文连接", () => {
    expect(holidayNamesText(["国庆节"])).toBe("国庆节");
    expect(holidayNamesText(["国庆节", "中秋节"])).toBe("国庆节、中秋节");
    expect(() => holidayNamesText([])).toThrow(/假期名不能为空/);
  });

  it("主文案区分休假与补班", () => {
    expect(chinaDayLabelText(dayOf("2026-10-01"))).toBe("国庆节假期");
    expect(chinaDayLabelText(dayOf("2026-10-10"))).toBe("国庆节补班日");
    expect(chinaDayLabelText(dayOf("2025-10-06"))).toBe("国庆节、中秋节假期");
    expect(chinaDayLabelText(dayOf("2026-02-14"))).toBe("春节补班日");
  });

  it("连休位置只写多天假期，单日假期与补班日不写", () => {
    expect(chinaDayPositionText(dayOf("2026-10-01"))).toBe("第 1 天 / 共 7 天");
    expect(chinaDayPositionText(dayOf("2026-10-03"))).toBe("第 3 天 / 共 7 天");
    expect(chinaDayPositionText(dayOf("2026-02-23"))).toBe("第 9 天 / 共 9 天");
    // 只放一天：2025 年元旦。
    expect(chinaDayPositionText(dayOf("2025-01-01"))).toBeUndefined();
    // 补班日不属于连休。
    expect(chinaDayPositionText(dayOf("2026-10-10"))).toBeUndefined();
  });
});
