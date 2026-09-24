import { describe, expect, it } from "vitest";
import { lunarDateOfKey } from "./lunar";
import {
  chinaHolidays,
  createChinaHolidayCalendar,
  type ChinaRestDay,
} from "./holidays";
import {
  HOLIDAY_ARRANGEMENTS,
  type HolidayArrangementData,
  type HolidayItemData,
} from "./holidays-data";

/**
 * 法定节假日测试（SC-011 验收：日期正确、连休可识别、补班与休假语义不同、
 * 数据版本可追踪、数据缺失不猜）。
 *
 * 事实来源是国务院办公厅通知原文（holidays-data.ts 的 sourceUrl），
 * 这里把易错日期固定下来：春节假期必须包含农历正月初一、中秋必须包含
 * 八月十五、端午必须包含五月初五——农历表（lunar.ts）与通知数据来源独立，
 * 两者对上才说明登记的不是一串手抄错的日期。
 *
 * 不变量（每个安排都成立）：
 * - 放假日数 = 各条目区间天数之和（登记漏一天就会被抓到）；
 * - 连休区段连续、编号从 0 起、id 取首日；
 * - 补班日永远不是放假日，也没有连休区段。
 */

const DAY_MS = 86_400_000;

function epochDayOfKey(dateKey: string): number {
  return Math.round(Date.parse(`${dateKey}T00:00:00.000Z`) / DAY_MS);
}

function keyOfEpochDay(epochDay: number): string {
  return new Date(epochDay * DAY_MS).toISOString().slice(0, 10);
}

function dateKeysBetween(from: string, to: string): string[] {
  const keys: string[] = [];
  for (let day = epochDayOfKey(from); day <= epochDayOfKey(to); day += 1) {
    keys.push(keyOfEpochDay(day));
  }
  return keys;
}

function arrangementOf(year: number): HolidayArrangementData {
  const arrangement = HOLIDAY_ARRANGEMENTS.find((entry) => entry.year === year);
  if (!arrangement) {
    throw new Error(`测试缺少 ${year} 年安排`);
  }
  return arrangement;
}

function itemsOf(year: number): readonly HolidayItemData[] {
  return arrangementOf(year).items;
}

/** 通知里登记的每一个放假日，逐个向日历查询后返回。 */
function declaredRestDays(year: number): { key: string; day: ChinaRestDay }[] {
  const days: { key: string; day: ChinaRestDay }[] = [];
  for (const item of itemsOf(year)) {
    for (const range of item.rest) {
      for (const key of dateKeysBetween(range.from, range.to)) {
        const day = chinaHolidays.chinaHolidayOfKey(key);
        if (day?.kind !== "rest") {
          throw new Error(`${key} 不是放假日（${item.names.join("、")}）`);
        }
        days.push({ key, day });
      }
    }
  }
  return days;
}

function declaredMakeupDays(year: number): string[] {
  return itemsOf(year).flatMap((item) => [...item.makeup]);
}

/** 农历简写「月/日」，用于与通知里的农历表述互证。 */
function lunarKeyOf(dateKey: string): string {
  const lunar = lunarDateOfKey(dateKey);
  if (!lunar) {
    throw new Error(`农历数据缺失：${dateKey}`);
  }
  return `${lunar.month}/${lunar.day}`;
}

/** 在某个假期的放假区间里找出符合农历日期的哪一天。 */
function findLunarDay(
  year: number,
  itemName: string,
  lunarKey: string,
): string | undefined {
  const item = itemsOf(year).find((entry) => entry.names.includes(itemName));
  if (!item) {
    return undefined;
  }
  return item.rest
    .flatMap((range) => dateKeysBetween(range.from, range.to))
    .find((key) => lunarKeyOf(key) === lunarKey);
}

describe("放假与补班输出（SC-011 验收：休 / 补由统一 Provider 输出）", () => {
  it("放假日带假期名与连休位置", () => {
    expect(chinaHolidays.chinaHolidayOfKey("2026-10-01")).toMatchObject({
      kind: "rest",
      names: ["国庆节"],
      run: { id: "2026-10-01", index: 0, length: 7 },
    });
    expect(chinaHolidays.chinaHolidayOfKey("2026-10-07")).toMatchObject({
      kind: "rest",
      run: { id: "2026-10-01", index: 6, length: 7 },
    });
  });

  it("补班日与放假日语义不同（CN-003）", () => {
    const rest = chinaHolidays.chinaHolidayOfKey("2026-10-07");
    const makeup = chinaHolidays.chinaHolidayOfKey("2026-10-10");
    expect(rest?.kind).toBe("rest");
    expect(makeup).toMatchObject({ kind: "makeup", names: ["国庆节"] });
    // 补班日没有连休区段：它不是假期的一部分，而是被调走的周末。
    expect(makeup !== undefined && "run" in makeup).toBe(false);
  });

  it("每个补班日都是补班、每个放假日都不是补班", () => {
    for (const arrangement of HOLIDAY_ARRANGEMENTS) {
      for (const key of declaredMakeupDays(arrangement.year)) {
        expect(chinaHolidays.chinaHolidayOfKey(key)?.kind).toBe("makeup");
      }
      for (const { key } of declaredRestDays(arrangement.year)) {
        expect(chinaHolidays.chinaHolidayOfKey(key)?.kind).toBe("rest");
      }
    }
  });

  it("合并放假的条目把两个节日名都带上（2025 中秋并入国庆）", () => {
    expect(chinaHolidays.chinaHolidayOfKey("2025-10-06")).toMatchObject({
      kind: "rest",
      names: ["国庆节", "中秋节"],
    });
  });

  it("放假日数与通知口径一致", () => {
    // 各放假区间的天数之和（含区间内的周末——通知写「与周末连休」的日子
    // 在数据里同样是放假，因此比通知里的「共 X 天」多）；改数据时这里会先失败。
    expect(declaredRestDays(2024)).toHaveLength(32);
    expect(declaredRestDays(2025)).toHaveLength(28);
    expect(declaredRestDays(2026)).toHaveLength(33);
    expect(declaredMakeupDays(2024)).toHaveLength(8);
    expect(declaredMakeupDays(2025)).toHaveLength(5);
    expect(declaredMakeupDays(2026)).toHaveLength(6);
  });
});

describe("连休分组（SC-011 验收：连休可被 UI 识别为连续区段）", () => {
  it("区段连续、编号从 0 起、id 取首日", () => {
    for (const arrangement of HOLIDAY_ARRANGEMENTS) {
      const days = declaredRestDays(arrangement.year).sort(
        (a, b) => epochDayOfKey(a.key) - epochDayOfKey(b.key),
      );
      const runs = new Map<string, { key: string; day: ChinaRestDay }[]>();
      for (const entry of days) {
        const bucket = runs.get(entry.day.run.id);
        if (bucket === undefined) {
          runs.set(entry.day.run.id, [entry]);
        } else {
          bucket.push(entry);
        }
      }

      // 每条假期条目是一段连休（登记的数据里两条假期不接壤）。
      expect(runs.size).toBe(
        itemsOf(arrangement.year).filter((item) => item.rest.length > 0).length,
      );

      for (const [id, run] of runs) {
        expect(id).toBe(run[0].key);
        run.forEach((entry, index) => {
          expect(entry.day.run).toEqual({
            id,
            index,
            length: run.length,
          });
          if (index > 0) {
            expect(epochDayOfKey(entry.key)).toBe(
              epochDayOfKey(run[index - 1].key) + 1,
            );
          }
        });
      }
    }
  });

  it("相邻放假日共享区段 id，不同假期不共享", () => {
    const springFestival = chinaHolidays.chinaHolidayOfKey("2026-02-15");
    const nextDay = chinaHolidays.chinaHolidayOfKey("2026-02-16");
    const lastDay = chinaHolidays.chinaHolidayOfKey("2026-02-23");
    const qingming = chinaHolidays.chinaHolidayOfKey("2026-04-04");

    expect(springFestival?.kind === "rest" && springFestival.run.id).toBe(
      "2026-02-15",
    );
    expect(nextDay?.kind === "rest" && nextDay.run.id).toBe("2026-02-15");
    expect(lastDay?.kind === "rest" && lastDay.run.id).toBe("2026-02-15");
    expect(qingming?.kind === "rest" && qingming.run.id).toBe("2026-04-04");
  });

  it("元旦连休跨公历年时仍是一条安排里的一段", () => {
    const days = ["2023-12-30", "2023-12-31", "2024-01-01"].map((key) => {
      const day = chinaHolidays.chinaHolidayOfKey(key);
      expect(day?.kind).toBe("rest");
      return day as ChinaRestDay;
    });

    expect(days.map((day) => day.run)).toEqual([
      { id: "2023-12-30", index: 0, length: 3 },
      { id: "2023-12-30", index: 1, length: 3 },
      { id: "2023-12-30", index: 2, length: 3 },
    ]);
    // 归属发文年份：12 月这两天属于 2024 年安排，不是 2023 年。
    expect(days[0].version.year).toBe(2024);
  });
});

describe("日期准确性（与农历表互证）", () => {
  it("春节假期包含农历正月初一", () => {
    for (const arrangement of HOLIDAY_ARRANGEMENTS) {
      const newYearDay = findLunarDay(arrangement.year, "春节", "1/1");
      expect(newYearDay).toBeDefined();
      expect(chinaHolidays.chinaHolidayOfKey(newYearDay!)?.names).toEqual([
        "春节",
      ]);
    }
  });

  it("中秋假期包含农历八月十五，端午假期包含五月初五", () => {
    expect(findLunarDay(2024, "中秋节", "8/15")).toBe("2024-09-17");
    expect(findLunarDay(2026, "中秋节", "8/15")).toBe("2026-09-25");
    expect(findLunarDay(2025, "中秋节", "8/15")).toBe("2025-10-06");

    expect(findLunarDay(2024, "端午节", "5/5")).toBe("2024-06-10");
    expect(findLunarDay(2025, "端午节", "5/5")).toBe("2025-05-31");
    expect(findLunarDay(2026, "端午节", "5/5")).toBe("2026-06-19");
  });

  it("除夕在 2025 / 2026 是放假日，在 2024 只是鼓励休假（不登记）", () => {
    // 除夕 = 腊月最后一天，它在数据里出现的依据是通知写明放假：
    // 2025 年 1 月 28 日（腊月廿九）、2026 年 2 月 16 日（腊月廿九）都是假期首日，
    // 次日即正月初一；2024 年除夕（2 月 9 日，腊月三十）不在数据里，
    // 因为当年通知只写「鼓励各单位…安排职工在除夕休息」，没有放假规定。
    expect(lunarKeyOf("2025-01-28")).toBe("12/29");
    expect(lunarKeyOf("2025-01-29")).toBe("1/1");
    expect(chinaHolidays.chinaHolidayOfKey("2025-01-28")?.kind).toBe("rest");

    expect(lunarKeyOf("2026-02-16")).toBe("12/29");
    expect(lunarKeyOf("2026-02-17")).toBe("1/1");
    expect(chinaHolidays.chinaHolidayOfKey("2026-02-16")?.kind).toBe("rest");

    expect(lunarKeyOf("2024-02-09")).toBe("12/30");
    expect(lunarKeyOf("2024-02-10")).toBe("1/1");
    expect(chinaHolidays.chinaHolidayOfKey("2024-02-09")).toBeUndefined();
  });
});

describe("数据缺失不猜测（P-03）", () => {
  it("没有登记安排的年份查不到假期", () => {
    for (const key of [
      "2023-10-01",
      "2023-12-29",
      "2025-12-25",
      "2026-12-31",
      "2027-01-01",
      "2027-10-01",
    ]) {
      expect(chinaHolidays.chinaHolidayOfKey(key)).toBeUndefined();
    }
  });

  it("日期键非法时抛错，而不是当成没有安排", () => {
    expect(() => chinaHolidays.chinaHolidayOfKey("2026-1-1")).toThrow(
      RangeError,
    );
    expect(() => chinaHolidays.chinaHolidayOfKey("2026-02-30")).toThrow(
      RangeError,
    );
  });
});

describe("年份数据版本可追踪（CN-007）", () => {
  it("每个假期都能追到通知文号与发布日期", () => {
    expect(chinaHolidays.versions.map((version) => version.year)).toEqual([
      2024, 2025, 2026,
    ]);

    expect(chinaHolidays.chinaHolidayOfKey("2026-10-01")?.version).toEqual({
      year: 2026,
      revision: 1,
      notice: "国办发明电〔2025〕7号",
      publishedAt: "2025-11-04",
      sourceUrl:
        "https://www.gov.cn/zhengce/content/202511/content_7047090.htm",
    });

    // 跨年的放假日归属发文年份（2024 年安排里的 2023-12-30）。
    expect(chinaHolidays.chinaHolidayOfKey("2023-12-30")?.version.notice).toBe(
      "国办发明电〔2023〕7号",
    );
  });

  it("修订号逐个安排登记，用于标记数据修正", () => {
    for (const version of chinaHolidays.versions) {
      expect(version.revision).toBeGreaterThanOrEqual(1);
      expect(version.sourceUrl.startsWith("https://")).toBe(true);
    }
  });
});

describe("装配期校验（坏数据在装配阶段抛错）", () => {
  const META = {
    year: 2030,
    revision: 1,
    notice: "国办发明电〔2029〕1号",
    publishedAt: "2029-11-01",
    sourceUrl: "https://www.gov.cn/zhengce/2030.htm",
  };

  function calendarOf(
    items: readonly HolidayItemData[],
    overrides: Partial<typeof META> = {},
  ) {
    return createChinaHolidayCalendar([{ ...META, ...overrides, items }]);
  }

  const NEW_YEAR: HolidayItemData = {
    names: ["元旦"],
    rest: [{ from: "2030-01-01", to: "2030-01-03" }],
    makeup: ["2030-01-04"],
  };

  it("接受通知口径的正常数据", () => {
    const calendar = calendarOf([NEW_YEAR]);
    expect(calendar.chinaHolidayOfKey("2030-01-02")).toMatchObject({
      kind: "rest",
      run: { id: "2030-01-01", index: 1, length: 3 },
    });
    expect(calendar.versions).toHaveLength(1);
  });

  it("拒绝反向区间", () => {
    expect(() =>
      calendarOf([
        {
          names: ["劳动节"],
          rest: [{ from: "2030-05-05", to: "2030-05-01" }],
          makeup: [],
        },
      ]),
    ).toThrow(/区间反向/);
  });

  it("拒绝同一天既放假又补班", () => {
    expect(() => calendarOf([{ ...NEW_YEAR, makeup: ["2030-01-02"] }])).toThrow(
      /既放假又补班/,
    );
  });

  it("拒绝重复日期（条目之间也不能重叠）", () => {
    expect(() =>
      calendarOf([
        NEW_YEAR,
        {
          names: ["劳动节"],
          rest: [{ from: "2030-01-03", to: "2030-05-05" }],
          makeup: [],
        },
      ]),
    ).toThrow(/日期重复/);
  });

  it("拒绝不在安排年份范围内的日期", () => {
    expect(() =>
      calendarOf([
        {
          names: ["元旦"],
          rest: [{ from: "2031-01-01", to: "2031-01-03" }],
          makeup: [],
        },
      ]),
    ).toThrow(/不在范围内的日期/);
  });

  it("拒绝连休跨两条安排", () => {
    expect(() =>
      createChinaHolidayCalendar([
        {
          ...META,
          year: 2029,
          notice: "国办发明电〔2028〕1号",
          publishedAt: "2028-11-01",
          items: [
            {
              names: ["元旦"],
              rest: [{ from: "2029-12-31", to: "2029-12-31" }],
              makeup: [],
            },
          ],
        },
        { ...META, items: [NEW_YEAR] },
      ]),
    ).toThrow(/连休跨了两条安排/);
  });

  it("拒绝缺名、重名与空条目", () => {
    expect(() => calendarOf([{ ...NEW_YEAR, names: [] }])).toThrow(/没有名字/);
    expect(() =>
      calendarOf([
        NEW_YEAR,
        {
          names: ["元旦"],
          rest: [{ from: "2030-05-01", to: "2030-05-02" }],
          makeup: [],
        },
      ]),
    ).toThrow(/假期名重复/);
    expect(() =>
      calendarOf([{ names: ["元旦"], rest: [], makeup: [] }]),
    ).toThrow(/既没有放假日期也没有补班日期/);
  });

  it("拒绝非法的版本信息", () => {
    expect(() => calendarOf([NEW_YEAR], { revision: 0 })).toThrow(/修订号非法/);
    expect(() =>
      calendarOf([NEW_YEAR], { sourceUrl: "http://example.com/notice" }),
    ).toThrow(/必须是 https/);
    expect(() => calendarOf([NEW_YEAR], { publishedAt: "2032-01-01" })).toThrow(
      /发布日期不在上一年到当年之间/,
    );
    expect(() =>
      createChinaHolidayCalendar([
        { ...META, items: [NEW_YEAR] },
        { ...META, items: [NEW_YEAR] },
      ]),
    ).toThrow(/安排年份重复/);
  });

  it("拒绝空的安排列表", () => {
    expect(() => createChinaHolidayCalendar([])).toThrow(/数据为空/);
  });
});
