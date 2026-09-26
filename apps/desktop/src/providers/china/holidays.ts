import { epochDayOfKey, keyOfEpochDay } from "./date-key";
import {
  HOLIDAY_ARRANGEMENTS,
  type HolidayArrangementData,
  type HolidayItemData,
} from "./holidays-data";

/**
 * 法定节假日查询与连休分组（SC-011 / CN-002–004、CN-007）。
 *
 * 只做一件事：给定公历日期，回答「这一天是放假还是补班、属于哪个假期、
 * 在这一次连休里的位置」。判断规则来自通知数据（holidays-data.ts），
 * 这里不推导任何日期——放假安排没有公式，只有发文。
 *
 * 休假与补班是两种语义（CN-003），因此用可区分的联合类型表达：
 * 休假日带连休区段，补班日没有。UI 不需要判断布尔标志再决定怎么画。
 *
 * 连休区段（CN-004）：一次安排里连续放假的日期共享同一个 `run`，
 * `id` 取区段首日的日期键，`index` 从 0 起。相邻日期格拿到相同 id 就知道
 * 它们属于同一次假期，可以画成连续视觉（ui-design §7.1）；区段在数据
 * 校验阶段就保证连续，UI 不需要自己再扫一遍相邻格。
 *
 * 不猜测（P-03）：没有登记安排的年份、通知里没有规定的日期都返回
 * undefined，UI 安静地不显示休 / 补。2024 年除夕就是这种日期——当年
 * 通知只是「鼓励」休假，没有放假规定。
 */

/** 一天的语义类别：放假 / 补班（CN-002 / CN-003）。 */
export type ChinaDayKind = "rest" | "makeup";

/** 数据版本（CN-007）：一条安排对应一次国务院办公厅通知。 */
export interface HolidayDataVersion {
  /** 通知年份（数据集的年份键）。 */
  year: number;
  /** 本仓库内的数据修订号。 */
  revision: number;
  notice: string;
  /** 通知发布日期 YYYY-MM-DD。 */
  publishedAt: string;
  sourceUrl: string;
}

/** 连休区段：同一次连休共享 id，按日期升序编号。 */
export interface ChinaDayRun {
  /** 区段首日的日期键，稳定且在数据集内唯一。 */
  id: string;
  /** 该日在区段中的位置，从 0 起。 */
  index: number;
  /** 区段天数。 */
  length: number;
}

/** 放假日：带连休区段。 */
export interface ChinaRestDay {
  kind: "rest";
  /** 假期名（「国庆节、中秋节」）。 */
  names: readonly string[];
  run: ChinaDayRun;
  version: HolidayDataVersion;
}

/** 补班日：为哪个假期调的班，由 `names` 说明。 */
export interface ChinaMakeupWorkday {
  kind: "makeup";
  names: readonly string[];
  version: HolidayDataVersion;
}

export type ChinaHolidayDay = ChinaRestDay | ChinaMakeupWorkday;

export interface ChinaHolidayCalendar {
  /** 已登记的数据版本（按年份升序），供追溯与展示（CN-007）。 */
  readonly versions: readonly HolidayDataVersion[];
  /**
   * 查询某一天的放假 / 补班语义；没有安排的日子返回 undefined。
   * 日期键格式错误或不是真实存在的日期时抛 RangeError（调用方 bug）。
   */
  chinaHolidayOfKey(dateKey: string): ChinaHolidayDay | undefined;
}

/** 登记中的一天：区段计算需要天数，组装结果时需要假期名与版本。 */
interface RegisteredDay {
  dateKey: string;
  epochDay: number;
  names: readonly string[];
  version: HolidayDataVersion;
}

/**
 * 装配期校验后的日历（沿用「坏数据要么拒绝、要么确定降级」的原则）：
 * 数据文件写错——日期区间反向、同一天既放假又补班、连休被拆到两条安排里、
 * 年份与日期不匹配——都在这里直接抛错，而不是让 UI 在运行期画出
 * 一天休又一天补的月历。
 */
export function createChinaHolidayCalendar(
  arrangements: readonly HolidayArrangementData[],
): ChinaHolidayCalendar {
  if (arrangements.length === 0) {
    throw new Error("节假日数据为空");
  }

  const versions: HolidayDataVersion[] = [];
  const restByKey = new Map<string, RegisteredDay>();
  const makeupByKey = new Map<string, RegisteredDay>();

  for (const arrangement of arrangements) {
    const version = validateMeta(arrangement, versions);
    versions.push(version);

    const itemNames = new Set<string>();
    for (const item of arrangement.items) {
      validateItemNames(arrangement.year, item, itemNames);
      if (item.rest.length === 0 && item.makeup.length === 0) {
        throw new Error(
          `安排 ${arrangement.year} 的「${item.names.join("、")}」既没有放假日期也没有补班日期`,
        );
      }
      for (const range of item.rest) {
        const from = epochDayOfKey(range.from);
        const to = epochDayOfKey(range.to);
        if (to < from) {
          throw new Error(
            `安排 ${arrangement.year} 的区间反向：${range.from} → ${range.to}`,
          );
        }
        for (let epochDay = from; epochDay <= to; epochDay += 1) {
          register(restByKey, version, item, epochDay);
        }
      }
      for (const makeup of item.makeup) {
        register(makeupByKey, version, item, epochDayOfKey(makeup));
      }
    }
  }

  for (const day of makeupByKey.values()) {
    if (restByKey.has(day.dateKey)) {
      throw new Error(`同一天既放假又补班：${day.dateKey}`);
    }
  }
  assertRunsNotSplit(restByKey);

  const runs = computeRuns(restByKey);
  const index = new Map<string, ChinaHolidayDay>();
  for (const day of restByKey.values()) {
    const run = runs.get(day.dateKey);
    if (run === undefined) {
      throw new Error(`连休区段缺失：${day.dateKey}`);
    }
    index.set(day.dateKey, {
      kind: "rest",
      names: day.names,
      run,
      version: day.version,
    });
  }
  for (const day of makeupByKey.values()) {
    index.set(day.dateKey, {
      kind: "makeup",
      names: day.names,
      version: day.version,
    });
  }

  return {
    // 按年份升序返回，与数据文件里的书写顺序无关（展示「数据覆盖 2024–2026」时稳定）。
    versions: [...versions].sort((a, b) => a.year - b.year),
    chinaHolidayOfKey(dateKey) {
      // 先校验日期键，再查表：格式错误是调用方 bug，不应该被当成「没有安排」。
      epochDayOfKey(dateKey);
      return index.get(dateKey);
    },
  };
}

function validateMeta(
  arrangement: HolidayArrangementData,
  registered: readonly HolidayDataVersion[],
): HolidayDataVersion {
  const { year, revision, notice, publishedAt, sourceUrl } = arrangement;
  if (!Number.isInteger(year) || year < 1970 || year > 2999) {
    throw new Error(`安排年份非法：${year}`);
  }
  if (registered.some((version) => version.year === year)) {
    throw new Error(`安排年份重复：${year}`);
  }
  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error(`安排 ${year} 的数据修订号非法：${revision}`);
  }
  if (notice.trim() === "" || sourceUrl.trim() === "") {
    throw new Error(`安排 ${year} 缺少通知文号或来源地址`);
  }
  const publishedDay = epochDayOfKey(publishedAt);
  if (
    publishedDay < epochDayOfKey(`${year - 1}-01-01`) ||
    publishedDay > epochDayOfKey(`${year}-12-31`)
  ) {
    throw new Error(
      `安排 ${year} 的发布日期不在上一年到当年之间：${publishedAt}`,
    );
  }
  if (!sourceUrl.startsWith("https://")) {
    throw new Error(`安排 ${year} 的来源地址必须是 https：${sourceUrl}`);
  }
  return { year, revision, notice, publishedAt, sourceUrl };
}

function validateItemNames(
  year: number,
  item: HolidayItemData,
  registered: Set<string>,
): void {
  if (item.names.length === 0) {
    throw new Error(`安排 ${year} 存在没有名字的假期条目`);
  }
  for (const name of item.names) {
    if (name.trim() !== name || name === "") {
      throw new Error(`安排 ${year} 的假期名未规范化：${JSON.stringify(name)}`);
    }
    if (registered.has(name)) {
      throw new Error(`安排 ${year} 的假期名重复：${name}`);
    }
    registered.add(name);
  }
}

function register(
  target: Map<string, RegisteredDay>,
  version: HolidayDataVersion,
  item: HolidayItemData,
  epochDay: number,
): void {
  const dateKey = keyOfEpochDay(epochDay);
  const dateYear = Number(dateKey.slice(0, 4));
  // 元旦与上一年 12 月的周末连休，因此允许上一年 12 月；再远就是数据写错。
  const inPreviousDecember =
    dateYear === version.year - 1 && dateKey.startsWith(`${dateYear}-12`);
  if (dateYear !== version.year && !inPreviousDecember) {
    throw new Error(
      `安排 ${version.year} 出现了不在范围内的日期：${dateKey}（${item.names.join("、")}）`,
    );
  }
  if (target.has(dateKey)) {
    throw new Error(
      `安排 ${version.year} 的日期重复：${dateKey}（${item.names.join("、")}）`,
    );
  }
  target.set(dateKey, { dateKey, epochDay, names: item.names, version });
}

/**
 * 连休不能被拆到两条安排里：同一次假期的日期由同一份通知规定，
 * 如果某天与别的安排里的某天相邻放假，说明元旦与上一年 12 月周末
 * 这类跨年区间被登记到了错误的位置（放假日会变成两段视觉）。
 *
 * 一条安排内部的相邻日期不需要检查——区段就是按“连续的天”切出来的，
 * 同一条安排里挨着的放假日自动是一段。唯一的拆分来源是两条安排接壤。
 */
function assertRunsNotSplit(restByKey: Map<string, RegisteredDay>): void {
  for (const day of restByKey.values()) {
    for (const neighbour of [day.epochDay - 1, day.epochDay + 1]) {
      const other = restByKey.get(keyOfEpochDay(neighbour));
      if (other !== undefined && other.version.year !== day.version.year) {
        throw new Error(
          `连休跨了两条安排：${other.dateKey}（${other.version.year}）与 ${day.dateKey}（${day.version.year}）`,
        );
      }
    }
  }
}

/** 按安排分组、按日期升序切出连续区段；区段 id 取首日日期键。 */
function computeRuns(
  restByKey: Map<string, RegisteredDay>,
): Map<string, ChinaDayRun> {
  const byYear = new Map<number, RegisteredDay[]>();
  for (const day of restByKey.values()) {
    const bucket = byYear.get(day.version.year);
    if (bucket === undefined) {
      byYear.set(day.version.year, [day]);
    } else {
      bucket.push(day);
    }
  }

  const runs = new Map<string, ChinaDayRun>();
  for (const days of byYear.values()) {
    days.sort((a, b) => a.epochDay - b.epochDay);
    let start = 0;
    for (let index = 1; index <= days.length; index += 1) {
      const broken =
        index === days.length ||
        days[index].epochDay !== days[index - 1].epochDay + 1;
      if (!broken) continue;
      const id = days[start].dateKey;
      const length = index - start;
      for (let offset = start; offset < index; offset += 1) {
        runs.set(days[offset].dateKey, { id, index: offset - start, length });
      }
      start = index;
    }
  }
  return runs;
}

/** 应用级默认日历：数据来自 holidays-data.ts。 */
export const chinaHolidays: ChinaHolidayCalendar =
  createChinaHolidayCalendar(HOLIDAY_ARRANGEMENTS);
