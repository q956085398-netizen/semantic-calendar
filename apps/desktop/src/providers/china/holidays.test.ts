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
  type HolidayRange,
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

/**
 * 通知口径样例：样例值逐条读自通知原文（`holidays-data.ts` 里三个 `sourceUrl`
 * 页面），并且不读 `HOLIDAY_ARRANGEMENTS`。可核对的性质是「两处必须各改一次」，
 * 而不是「两个来源互相独立」——样例与数据文件读的是同一份通知，谁都不比谁更权威，
 * 但数据文件被改动而这张表没跟着改就会红。
 *
 * 与「日期准确性（与农历表互证）」一组的分工：那一组证明登记的日期不是一串乱码、
 * 并钉住几个易错日期，但整段区间挪一天、把补班日写错一天它都看不出来（数据文件
 * 自身仍然自洽，按年合计的天数也没变）；这一张表按通知原文逐条比对，并覆盖到每
 * 一年每一条通知条目（见本组最后一条用例）。
 *
 * 区间写法与数据文件同一口径：通知写「与周末连休」的（2024 元旦、端午）按连休
 * 区间登记，因此样例里的天数会多于通知里那句「共 X 天」。
 */
interface NoticeSample {
  /** 这条样例读自哪一年的通知，用于报错时定位。 */
  year: number;
  /** 通知里的条目名（合并放假的条目不止一段）。 */
  names: readonly string[];
  rest: HolidayRange;
  /** 通知里的「上班」日期，逐日登记。 */
  makeup: readonly string[];
}

const NOTICE_SAMPLES: readonly NoticeSample[] = [
  // 2024：国办发明电〔2023〕7号。
  {
    year: 2024,
    names: ["元旦"],
    rest: { from: "2023-12-30", to: "2024-01-01" },
    makeup: [],
  },
  {
    year: 2024,
    names: ["春节"],
    rest: { from: "2024-02-10", to: "2024-02-17" },
    makeup: ["2024-02-04", "2024-02-18"],
  },
  {
    year: 2024,
    names: ["清明节"],
    rest: { from: "2024-04-04", to: "2024-04-06" },
    makeup: ["2024-04-07"],
  },
  {
    year: 2024,
    names: ["劳动节"],
    rest: { from: "2024-05-01", to: "2024-05-05" },
    makeup: ["2024-04-28", "2024-05-11"],
  },
  {
    year: 2024,
    names: ["端午节"],
    rest: { from: "2024-06-08", to: "2024-06-10" },
    makeup: [],
  },
  {
    year: 2024,
    names: ["中秋节"],
    rest: { from: "2024-09-15", to: "2024-09-17" },
    makeup: ["2024-09-14"],
  },
  {
    year: 2024,
    names: ["国庆节"],
    rest: { from: "2024-10-01", to: "2024-10-07" },
    makeup: ["2024-09-29", "2024-10-12"],
  },
  // 2025：国办发明电〔2024〕12号。
  {
    year: 2025,
    names: ["元旦"],
    rest: { from: "2025-01-01", to: "2025-01-01" },
    makeup: [],
  },
  {
    year: 2025,
    names: ["春节"],
    rest: { from: "2025-01-28", to: "2025-02-04" },
    makeup: ["2025-01-26", "2025-02-08"],
  },
  {
    year: 2025,
    names: ["清明节"],
    rest: { from: "2025-04-04", to: "2025-04-06" },
    makeup: [],
  },
  {
    year: 2025,
    names: ["劳动节"],
    rest: { from: "2025-05-01", to: "2025-05-05" },
    makeup: ["2025-04-27"],
  },
  {
    year: 2025,
    names: ["端午节"],
    rest: { from: "2025-05-31", to: "2025-06-02" },
    makeup: [],
  },
  {
    year: 2025,
    names: ["国庆节", "中秋节"],
    rest: { from: "2025-10-01", to: "2025-10-08" },
    makeup: ["2025-09-28", "2025-10-11"],
  },
  // 2026：国办发明电〔2025〕7号。
  {
    year: 2026,
    names: ["元旦"],
    rest: { from: "2026-01-01", to: "2026-01-03" },
    makeup: ["2026-01-04"],
  },
  {
    year: 2026,
    names: ["春节"],
    rest: { from: "2026-02-15", to: "2026-02-23" },
    makeup: ["2026-02-14", "2026-02-28"],
  },
  {
    year: 2026,
    names: ["清明节"],
    rest: { from: "2026-04-04", to: "2026-04-06" },
    makeup: [],
  },
  {
    year: 2026,
    names: ["劳动节"],
    rest: { from: "2026-05-01", to: "2026-05-05" },
    makeup: ["2026-05-09"],
  },
  {
    year: 2026,
    names: ["端午节"],
    rest: { from: "2026-06-19", to: "2026-06-21" },
    makeup: [],
  },
  {
    year: 2026,
    names: ["中秋节"],
    rest: { from: "2026-09-25", to: "2026-09-27" },
    makeup: [],
  },
  {
    year: 2026,
    names: ["国庆节"],
    rest: { from: "2026-10-01", to: "2026-10-07" },
    makeup: ["2026-09-20", "2026-10-10"],
  },
];

describe("通知口径样例（逐条读自通知原文）", () => {
  it("放假区间内每一天都是放假日，假期名与通知条目一致", () => {
    for (const sample of NOTICE_SAMPLES) {
      for (const key of dateKeysBetween(sample.rest.from, sample.rest.to)) {
        expect(
          chinaHolidays.chinaHolidayOfKey(key),
          `${sample.year} 年通知：${key}`,
        ).toMatchObject({ kind: "rest", names: sample.names });
      }
    }
  });

  it("区间首尾之外的一天不是放假日", () => {
    for (const sample of NOTICE_SAMPLES) {
      // 通知条目之间不接壤，区间外相邻的那一天就不该是放假日（将来真接壤时，
      // 这条与数据都要显式改）。整段区间挪一天而天数不变时，只有这一条与前一条
      // 会红——按年合计的「放假日数」对挪位是瞎的。
      for (const key of [
        keyOfEpochDay(epochDayOfKey(sample.rest.from) - 1),
        keyOfEpochDay(epochDayOfKey(sample.rest.to) + 1),
      ]) {
        expect(
          chinaHolidays.chinaHolidayOfKey(key)?.kind,
          `${sample.year} 年通知：${key}`,
        ).not.toBe("rest");
      }
    }
  });

  it("补班日逐条登记正确", () => {
    for (const sample of NOTICE_SAMPLES) {
      for (const key of sample.makeup) {
        expect(
          chinaHolidays.chinaHolidayOfKey(key),
          `${sample.year} 年通知：${key}`,
        ).toMatchObject({ kind: "makeup", names: sample.names });
      }
    }
  });

  it("覆盖每一年与每一条通知条目（新增年份 / 条目必须补样例）", () => {
    // CN-007 的可更新策略是「发布下一年度通知后追加一条安排并补测试样例」。
    // 这一条把「补样例」变成可执行的：只加数据不加样例会红，并直接指出缺哪一年、
    // 缺哪一条条目（缺日期的空档由上面几条按天断言，这里管的是范围）。
    const sampledNames = new Map<number, Set<string>>();
    for (const sample of NOTICE_SAMPLES) {
      const names = sampledNames.get(sample.year) ?? new Set<string>();
      names.add(sample.names.join("、"));
      sampledNames.set(sample.year, names);
    }

    expect([...sampledNames.keys()].sort()).toEqual(
      HOLIDAY_ARRANGEMENTS.map((arrangement) => arrangement.year).sort(),
    );
    for (const arrangement of HOLIDAY_ARRANGEMENTS) {
      expect(
        [...(sampledNames.get(arrangement.year) ?? [])].sort(),
        `${arrangement.year} 年通知的条目`,
      ).toEqual(arrangement.items.map((item) => item.names.join("、")).sort());
    }
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
  it("每一天都能追到所属安排的通知文号（跨年放假日归属发文年份）", () => {
    // 元数据本身由下一条逐条锁定；这一条管的是归属：日期的 version 就是它所属
    // 那一年登记的那一条，跨年的放假日按发文年份算（2024 年安排里的 2023-12-30
    // 属于〔2023〕7号，而不是 2023 年的另一份通知）。因此断言写成「与那一年登记的
    // 版本对象一致」，而不是在这里再抄一份文号——文号只锁一处。
    const versionOfYear = (year: number) =>
      chinaHolidays.versions.find((version) => version.year === year);
    const versionOfKey = (key: string) =>
      chinaHolidays.chinaHolidayOfKey(key)?.version;

    expect(versionOfKey("2023-12-30")?.year).toBe(2024);
    expect(versionOfKey("2023-12-30")).toEqual(versionOfYear(2024));
    expect(versionOfKey("2025-10-06")).toEqual(versionOfYear(2025));
    expect(versionOfKey("2026-10-01")).toEqual(versionOfYear(2026));
  });

  it("版本清单逐条登记文号、发布日期、来源地址与修订号", () => {
    // 装配期校验已经保证 revision ≥ 1、来源是 https、发布日期落在合法区间
    // （见「装配期校验」一组），因此再断言一遍这些条件证明不了任何事——
    // 这里锁的是登记内容本身：改文号、改发布日期、改来源地址或推进修订号，
    // 都必须显式改这张表（CN-007：可追溯、数据修正可标记）。
    expect(chinaHolidays.versions).toEqual([
      {
        year: 2024,
        revision: 1,
        notice: "国办发明电〔2023〕7号",
        publishedAt: "2023-10-25",
        sourceUrl:
          "https://www.gov.cn/zhengce/zhengceku/202310/content_6911528.htm",
      },
      {
        year: 2025,
        revision: 1,
        notice: "国办发明电〔2024〕12号",
        publishedAt: "2024-11-12",
        sourceUrl:
          "https://www.gov.cn/zhengce/content/202411/content_6986382.htm",
      },
      {
        year: 2026,
        revision: 1,
        notice: "国办发明电〔2025〕7号",
        publishedAt: "2025-11-04",
        sourceUrl:
          "https://www.gov.cn/zhengce/content/202511/content_7047090.htm",
      },
    ]);
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
