import { describe, expect, it } from "vitest";
import {
  SOLAR_TERMS,
  SOLAR_TERM_FIRST_DATE_KEY,
  SOLAR_TERM_LAST_DATE_KEY,
  assertSolarTermTable,
  solarTermOfKey,
  type SolarTerm,
} from "./solar-terms";
import {
  SOLAR_TERM_DAY_DATA,
  SOLAR_TERM_FIRST_YEAR,
  SOLAR_TERM_LAST_YEAR,
} from "./solar-terms-data";

/**
 * 二十四节气测试（SC-012 验收：24 节气日期可正确生成 / 读取、有日期准确性测试）。
 *
 * 样例来源：香港天文台「公曆與農曆日期對照表」年表的「節氣」列（官方历法数据），
 * 与农历表（lunar-data.ts）同一批文件。日期表由 tools/derive-solar-terms.mjs
 * 从同一来源推导，这里挑出易错日期固定下来：跨世纪年份、立春 / 清明 / 冬至
 * 这些落在月界附近、公开资料里能逐一对照的日子。
 */

/** 官方年表样例：日期键 → 节气名。 */
const OFFICIAL_SAMPLES: ReadonlyArray<readonly [string, string]> = [
  // 1901（表首年）
  ["1901-01-06", "小寒"],
  ["1901-02-04", "立春"],
  ["1901-04-05", "清明"],
  ["1901-12-22", "冬至"],
  // 1950
  ["1950-01-06", "小寒"],
  ["1950-02-04", "立春"],
  ["1950-06-22", "夏至"],
  ["1950-10-24", "霜降"],
  // 2000
  ["2000-01-06", "小寒"],
  ["2000-04-04", "清明"],
  ["2000-12-21", "冬至"],
  // 2024：清明 4 月 4 日、冬至 12 月 21 日
  ["2024-02-04", "立春"],
  ["2024-04-04", "清明"],
  ["2024-12-21", "冬至"],
  // 2025：立春落在 2 月 3 日（少见）
  ["2025-02-03", "立春"],
  ["2025-04-04", "清明"],
  ["2025-12-21", "冬至"],
  // 2026：与 ui-design 参考图一致（10 月 8 日寒露、10 月 23 日霜降）
  ["2026-01-05", "小寒"],
  ["2026-02-04", "立春"],
  ["2026-04-05", "清明"],
  ["2026-06-21", "夏至"],
  ["2026-10-08", "寒露"],
  ["2026-10-23", "霜降"],
  ["2026-12-22", "冬至"],
  // 2027
  ["2027-02-04", "立春"],
  ["2027-06-06", "芒种"],
  ["2027-09-08", "白露"],
  // 2100（表末年）
  ["2100-01-05", "小寒"],
  ["2100-04-05", "清明"],
  ["2100-12-22", "冬至"],
];

/** 节气按序号应有的公历月：序号 2m−1 / 2m 都在 m 月。 */
function expectedMonth(index: number): number {
  return Math.ceil(index / 2);
}

describe("二十四节气查询（CN-006）", () => {
  it("官方年表样例逐条对上", () => {
    for (const [dateKey, name] of OFFICIAL_SAMPLES) {
      expect([dateKey, solarTermOfKey(dateKey)?.name]).toEqual([dateKey, name]);
    }
  });

  it("不是节气的日期返回 undefined", () => {
    for (const dateKey of [
      "2026-01-04", // 小寒前一天
      "2026-01-06", // 小寒后一天
      "2026-10-07",
      "2026-10-09",
      "2026-02-28",
      "2026-12-31",
    ]) {
      expect([dateKey, solarTermOfKey(dateKey)]).toEqual([dateKey, undefined]);
    }
  });

  it("每个公历年恰好 24 个节气，且按序号递增", () => {
    for (
      let year = SOLAR_TERM_FIRST_YEAR;
      year <= SOLAR_TERM_LAST_YEAR;
      year += 1
    ) {
      const hits: SolarTerm[] = [];
      // 按真实存在的日期逐日走一年（不能用 1–31 硬扫：2 月 30 日会抛错）。
      const lastDay = Date.UTC(year, 11, 31);
      for (let ms = Date.UTC(year, 0, 1); ms <= lastDay; ms += 86_400_000) {
        const term = solarTermOfKey(new Date(ms).toISOString().slice(0, 10));
        if (term !== undefined) hits.push(term);
      }
      expect([year, hits.length]).toEqual([year, 24]);
      expect([year, hits.map((term) => term.index)]).toEqual([
        year,
        SOLAR_TERMS.map((term) => term.index),
      ]);
    }
  });

  it("每个节气都落在自己的公历月，且日期在常见窗口内", () => {
    // 节气日期由天文数据决定，但每个节气在公历里的落点是稳定的：
    // 月初的节气落在 3–9 日，月中的节气落在 18–24 日。越界说明表串行了。
    for (const term of SOLAR_TERMS) {
      const days = SOLAR_TERM_DAY_DATA.map((row) => row[term.index - 1]);
      const min = Math.min(...days);
      const max = Math.max(...days);
      const inFirstHalf = term.index % 2 === 1;
      expect([
        term.name,
        min >= (inFirstHalf ? 3 : 18) && max <= (inFirstHalf ? 9 : 24),
      ]).toEqual([term.name, true]);
      expect([term.name, term.month]).toEqual([
        term.name,
        expectedMonth(term.index),
      ]);
    }
  });

  it("表范围之外安静地返回 undefined，不猜日期", () => {
    expect(solarTermOfKey("1900-12-31")).toBeUndefined();
    expect(solarTermOfKey("2101-01-01")).toBeUndefined();
    // 边界两天仍然在表内（冬至之后 / 小寒之前）
    expect(solarTermOfKey(SOLAR_TERM_FIRST_DATE_KEY)).toBeUndefined();
    expect(solarTermOfKey(SOLAR_TERM_LAST_DATE_KEY)).toBeUndefined();
  });

  it("非法日期键抛 RangeError", () => {
    expect(() => solarTermOfKey("2026-2-4")).toThrow(RangeError);
    expect(() => solarTermOfKey("20260204")).toThrow(RangeError);
    expect(() => solarTermOfKey("2026-02-30")).toThrow(RangeError);
  });
});

describe("节气表结构校验", () => {
  it("合法表通过", () => {
    expect(() =>
      assertSolarTermTable(SOLAR_TERMS, SOLAR_TERM_DAY_DATA),
    ).not.toThrow();
  });

  it("缺项、行数不符、同月逆序都被拒绝", () => {
    const shortTerms = SOLAR_TERMS.slice(0, 23);
    expect(() => assertSolarTermTable(shortTerms, SOLAR_TERM_DAY_DATA)).toThrow(
      /24 条/,
    );

    const shortData = SOLAR_TERM_DAY_DATA.slice(0, 199);
    expect(() => assertSolarTermTable(SOLAR_TERMS, shortData)).toThrow(
      /应有 200 年/,
    );

    const missingDay = SOLAR_TERM_DAY_DATA.map((row, index) =>
      index === 0 ? row.slice(0, 23) : row,
    );
    expect(() => assertSolarTermTable(SOLAR_TERMS, missingDay)).toThrow(
      /应有 24 个/,
    );

    const reversed = SOLAR_TERM_DAY_DATA.map((row, index) =>
      index === 0 ? [20, 6, ...row.slice(2)] : row,
    );
    expect(() => assertSolarTermTable(SOLAR_TERMS, reversed)).toThrow(
      /不晚于同月前一个节气/,
    );

    const outOfRange = SOLAR_TERM_DAY_DATA.map((row, index) =>
      index === 0 ? [0, ...row.slice(1)] : row,
    );
    expect(() => assertSolarTermTable(SOLAR_TERMS, outOfRange)).toThrow(
      /日期非法/,
    );
  });
});
