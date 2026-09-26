import { describe, expect, it } from "vitest";
import { lunarDateOfKey, lunarMonthDays } from "./lunar";
import {
  FESTIVALS,
  chinaFestivals,
  createFestivalCalendar,
  type Festival,
} from "./festivals";

/**
 * 传统节日测试（SC-012 验收：中秋等常见传统节日可识别、有日期准确性测试）。
 *
 * 样例来源：香港天文台「公曆與農曆日期對照表」年表（官方历法数据），
 * 与农历表（lunar-data.ts）同一批文件——节日的判定走农历换算，但样例日期
 * 是从年表里逐日抄出来的，两边对上才说明判定不是自证。
 *
 * 不变量（每个农历年都成立）：
 * - 除夕永远是正月初一的前一天（腊月 29 或 30 天由数据决定，不写死）；
 * - 每个农历日期型节日在每个农历年恰好出现一次（闰月不算节日）；
 * - 节日规则不重复：两个节日不会落在同一天。
 */

/** 官方年表样例：日期键 → 节日名。 */
const OFFICIAL_SAMPLES: ReadonlyArray<readonly [string, string]> = [
  ["2024-02-09", "除夕"],
  ["2024-02-10", "春节"],
  ["2024-02-24", "元宵节"],
  ["2024-04-04", "清明节"],
  ["2024-06-10", "端午节"],
  ["2024-08-10", "七夕"],
  ["2024-09-17", "中秋节"],
  ["2024-10-11", "重阳节"],
  ["2025-01-28", "除夕"],
  ["2025-01-29", "春节"],
  ["2025-05-31", "端午节"],
  ["2025-10-06", "中秋节"],
  ["2026-02-16", "除夕"],
  ["2026-02-17", "春节"],
  ["2026-04-05", "清明节"],
  ["2026-06-19", "端午节"],
  ["2026-09-25", "中秋节"],
  ["2026-10-18", "重阳节"],
  ["2027-02-05", "除夕"],
  ["2027-02-06", "春节"],
  ["2027-09-15", "中秋节"],
];

function namesOfKey(dateKey: string): string[] {
  return chinaFestivals
    .festivalsOfKey(dateKey)
    .map((festival) => festival.name);
}

describe("传统节日判定（CN-005）", () => {
  it("官方年表样例逐条对上", () => {
    for (const [dateKey, name] of OFFICIAL_SAMPLES) {
      expect([dateKey, namesOfKey(dateKey)]).toEqual([dateKey, [name]]);
    }
  });

  it("普通日期没有节日", () => {
    for (const dateKey of [
      "2026-01-01", // 元旦是法定节假日，不是传统节日
      "2026-02-15", // 除夕前一天
      "2026-02-18", // 正月初二
      "2026-09-24", // 中秋前一天
      "2026-10-08", // 寒露：节气不是节日
      "2026-12-22", // 冬至：节气不是节日
    ]) {
      expect([dateKey, namesOfKey(dateKey)]).toEqual([dateKey, []]);
    }
  });

  it("清明当天同时是节气与节日（两条语义都成立）", () => {
    expect(namesOfKey("2026-04-05")).toEqual(["清明节"]);
  });

  it("闰月的同名日期不是节日", () => {
    // 2025 年闰六月：闰六月十五不是中元节（中元节是七月十五）。
    expect(lunarDateOfKey("2025-08-08")).toMatchObject({
      month: 6,
      day: 15,
      isLeapMonth: true,
    });
    expect(namesOfKey("2025-08-08")).toEqual([]);
    // 同年七月十五才是中元节。
    expect(lunarDateOfKey("2025-09-06")).toMatchObject({
      month: 7,
      day: 15,
      isLeapMonth: false,
    });
    expect(namesOfKey("2025-09-06")).toEqual(["中元节"]);
  });

  it("农历范围之外安静地不判定", () => {
    expect(namesOfKey("1900-06-01")).toEqual([]);
    expect(namesOfKey("2101-02-01")).toEqual([]);
  });

  it("非法日期键抛 RangeError", () => {
    expect(() => chinaFestivals.festivalsOfKey("2026-2-17")).toThrow(
      RangeError,
    );
    expect(() => chinaFestivals.festivalsOfKey("2026-02-30")).toThrow(
      RangeError,
    );
  });
});

describe("节日不变量", () => {
  /** 官方年表的春节日期（与 lunar.test.ts 同一批样例）。 */
  const SPRING_FESTIVAL_KEYS = [
    "1949-01-29",
    "2000-02-05",
    "2020-01-25",
    "2024-02-10",
    "2025-01-29",
    "2026-02-17",
    "2033-01-31",
    "2099-01-21",
  ];

  function previousDayKey(dateKey: string): string {
    return new Date(Date.parse(`${dateKey}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
  }

  it("除夕永远是春节前一天，且落在腊月最后一天", () => {
    for (const springKey of SPRING_FESTIVAL_KEYS) {
      const eveKey = previousDayKey(springKey);
      expect([springKey, namesOfKey(eveKey)]).toEqual([springKey, ["除夕"]]);
      const eve = lunarDateOfKey(eveKey);
      if (eve === undefined) throw new Error(`${eveKey} 超出农历表范围`);
      expect([eveKey, eve.month, eve.isLeapMonth]).toEqual([eveKey, 12, false]);
      // 腊月是 29 还是 30 天由年数据决定，除夕必须是那一天。
      expect([eveKey, eve.day]).toEqual([eveKey, lunarMonthDays(eve.year, 12)]);
    }
  });

  it("固定农历日期的节日每年都存在（日期都不超过廿九）", () => {
    // 农历月只有 29 / 30 天，规则里的日不超过 29 就保证每个农历年都有这一天，
    // 不会出现「某些年份这个节日消失」。除夕是唯一的月末规则，另行判定。
    for (const festival of FESTIVALS) {
      if (festival.rule.kind !== "lunar-date") continue;
      expect([festival.name, festival.rule.day <= 29]).toEqual([
        festival.name,
        true,
      ]);
    }
  });

  it("腊月长度 29 / 30 两种情形都真实存在", () => {
    const lengths = new Set<number>();
    for (let lunarYear = 1901; lunarYear <= 2099; lunarYear += 1) {
      lengths.add(lunarMonthDays(lunarYear, 12));
    }
    expect([...lengths].sort()).toEqual([29, 30]);
  });

  it("农历表首日的前一天没有除夕可判（安静地不显示，不猜）", () => {
    // 1901-02-19 是农历表首日（正月初一），前一天在表外，
    // 因此这一年没有除夕语义，而不是补一个近似日期。
    expect(lunarDateOfKey("1901-02-18")).toBeUndefined();
    expect(namesOfKey("1901-02-18")).toEqual([]);
  });
});

describe("节日表装配校验", () => {
  it("内置表通过校验", () => {
    expect(() => createFestivalCalendar(FESTIVALS)).not.toThrow();
  });

  it("重复规则、越界日期、不存在的节气 id 都被拒绝", () => {
    const base: Festival = {
      id: "x",
      name: "测试节",
      nameEn: "Test",
      rule: { kind: "lunar-date", month: 3, day: 3 },
    };
    const duplicateRule: Festival = {
      ...base,
      id: "y",
      name: "重复节",
    };
    expect(() => createFestivalCalendar([base, duplicateRule])).toThrow(
      /规则重复/,
    );

    expect(() =>
      createFestivalCalendar([
        { ...base, rule: { kind: "lunar-date", month: 13, day: 1 } },
      ]),
    ).toThrow(/农历月份非法/);

    expect(() =>
      createFestivalCalendar([
        { ...base, rule: { kind: "lunar-date", month: 1, day: 31 } },
      ]),
    ).toThrow(/农历日非法/);

    expect(() =>
      createFestivalCalendar([
        { ...base, rule: { kind: "solar-term", termId: "no-such-term" } },
      ]),
    ).toThrow(/不存在的节气/);
  });

  it("空表被拒绝（静默失效的节日表比抛错更危险）", () => {
    expect(() => createFestivalCalendar([])).toThrow(/为空/);
  });
});
