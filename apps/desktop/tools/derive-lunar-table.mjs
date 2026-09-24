// 从香港天文台官方对照表推导农历年数据表（1901–2099）。
// 用法：node derive-lunar-table.mjs <hko目录> <输出 ts 路径> [校验用每日数据 json]
//
// 数据来源：香港天文台「公曆與農曆日期對照表」年表文本
//   https://www.hko.gov.hk/tc/gts/time/calendar/text/files/T<年>c.txt
//   1932 年中文表在服务端被截断，改用同站英文表 T1932e.txt 补齐该年月份边界。
//   年表文本不随仓库分发，重跑前需先把 T1901c.txt–T2100c.txt 下载到 <hko目录>。
// 输出：每个农历年一条 17 位数据（编码见 lunar-data.ts 注释）；
// 可选第三个参数导出「日期 → 官方农历文本」，供开发期逐日回环校验换算实现
// （临时测试读这份 json 与 src/providers/china/lunar.ts 对环，跑完即弃，不入库）。
//
// 注意：这里的日名 / 月名表是解析与导出用的副本，展示口径以
// src/providers/china/lunar-labels.ts 为准；两边改动要一起改。
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const out = process.argv[3];
const daysOut = process.argv[4];

const MONTH_NAMES = [
  "正月",
  "二月",
  "三月",
  "四月",
  "五月",
  "六月",
  "七月",
  "八月",
  "九月",
  "十月",
  "十一月",
  "十二月",
];
const DAY_NAMES = [
  "初一",
  "初二",
  "初三",
  "初四",
  "初五",
  "初六",
  "初七",
  "初八",
  "初九",
  "初十",
  "十一",
  "十二",
  "十三",
  "十四",
  "十五",
  "十六",
  "十七",
  "十八",
  "十九",
  "二十",
  "廿一",
  "廿二",
  "廿三",
  "廿四",
  "廿五",
  "廿六",
  "廿七",
  "廿八",
  "廿九",
  "三十",
];

/** 日期键 YYYY-MM-DD → 官方农历文本（初一为月名，其余为日名）。 */
const days = new Map();

function parseChinese() {
  for (const file of readdirSync(dir).filter((n) => /^T\d{4}c\.txt$/.test(n))) {
    const text = readFileSync(path.join(dir, file), "utf8").replace(
      /^\uFEFF/,
      "",
    );
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\S+)\s+星期/);
      if (!m) continue;
      const key = `${m[1].padStart(4, "0")}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      days.set(key, m[4]);
    }
  }
}

function parseEnglish1932() {
  const text = readFileSync(path.join(dir, "T1932e.txt"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(
      /^(1932)\/(\d{2})\/(\d{2})\s+(\S.*?)\s{2,}(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/,
    );
    if (!m) continue;
    const key = `${m[1]}-${m[2]}-${m[3]}`;
    const value = m[4].trim();
    const monthStart = value.match(
      /^(?:(\d+)(?:st|nd|rd|th) Lunar month|Leap (\d+)(?:st|nd|rd|th) Lunar month)$/,
    );
    if (monthStart) {
      days.set(
        key,
        `${monthStart[2] ? "閏" : ""}${MONTH_NAMES[Number(monthStart[2] ?? monthStart[1]) - 1]}`,
      );
      continue;
    }
    const day = Number(value);
    if (!Number.isInteger(day) || day < 1 || day > 30) {
      console.log("未识别行：", line.trim());
      continue;
    }
    days.set(key, DAY_NAMES[day - 1]);
  }
}

parseChinese();
parseEnglish1932();

// ---- 逐日推导：月份起始 ----
const sorted = [...days.keys()].sort();
console.log(
  `覆盖 ${sorted.length} 天：${sorted[0]} → ${sorted[sorted.length - 1]}`,
);

const monthStarts = []; // { date, month, isLeap }
for (const date of sorted) {
  const text = days.get(date);
  const isMonthStart = DAY_NAMES.includes(text) ? text === "初一" : true;
  if (!isMonthStart) continue;
  const monthMatch = text.match(
    /^(閏)?(正月|二月|三月|四月|五月|六月|七月|八月|九月|十月|十一月|十二月)$/,
  );
  if (!monthMatch) {
    console.log("月份起始行无法解析：", date, text);
    continue;
  }
  monthStarts.push({
    date,
    month: MONTH_NAMES.indexOf(monthMatch[2]) + 1,
    isLeap: monthMatch[1] === "閏",
  });
}
console.log(`月份起始 ${monthStarts.length} 个`);

// ---- 组装农历年：正月起始 → 下一个正月起始 ----
const newYearIndexes = monthStarts
  .map((start, index) => (start.month === 1 && !start.isLeap ? index : -1))
  .filter((index) => index >= 0);
const years = new Map();
for (let k = 0; k + 1 < newYearIndexes.length; k += 1) {
  const from = newYearIndexes[k];
  const to = newYearIndexes[k + 1];
  const start = monthStarts[from];
  years.set(Number(start.date.slice(0, 4)), {
    nextStart: monthStarts[to].date,
    months: monthStarts.slice(from, to),
  });
}

const entries = [];
for (const [lunarYear, info] of [...years].sort((a, b) => a[0] - b[0])) {
  const { months } = info;
  if (months.length !== 12 && months.length !== 13) {
    console.log(`${lunarYear} 月数异常：${months.length}`);
  }
  const lengths = months.map((m, index) => {
    const next = months[index + 1];
    const from = Date.parse(`${m.date}T00:00:00Z`);
    const to = Date.parse(`${next ? next.date : info.nextStart}T00:00:00Z`);
    return Math.round((to - from) / 86400000);
  });
  const leapIndex = months.findIndex((m) => m.isLeap);
  const leapMonth = leapIndex >= 0 ? months[leapIndex].month : 0;
  const leapDays = leapIndex >= 0 ? lengths[leapIndex] : 0;
  // 位编码：bit16 闰月天数(30/29)、bit15..bit4 正月…十二月大小月、bit3..bit0 闰月月份
  let value = leapDays === 30 ? 0x10000 : 0;
  for (let i = 0; i < 12; i += 1) {
    const month = i + 1;
    const index = months.findIndex((m) => m.month === month && !m.isLeap);
    if (index < 0) {
      console.log(`${lunarYear} 缺少 ${month} 月`);
      continue;
    }
    if (lengths[index] === 30) value |= 0x8000 >> i;
  }
  value |= leapMonth;
  entries.push({ lunarYear, value, months, lengths, leapMonth, leapDays });
}

console.log(
  `农历年 ${entries.length} 个：${entries[0].lunarYear} → ${entries[entries.length - 1].lunarYear}`,
);
const bad = entries.filter((e) => e.lengths.some((l) => l !== 29 && l !== 30));
console.log(`含非法月长的年数：${bad.length}`);
const yearLen = entries.map((e) => e.lengths.reduce((a, b) => a + b, 0));
console.log(`年长范围：${Math.min(...yearLen)} – ${Math.max(...yearLen)}`);
console.log(
  "闰月分布：",
  entries
    .filter((e) => e.leapMonth)
    .map((e) => `${e.lunarYear}:${e.leapMonth}`)
    .join(" "),
);

const header = `/**
 * 农历年数据（lunar-data.ts）— 由 tools/derive-lunar-table.mjs 生成，请勿手改。
 *
 * 数据来源：香港天文台「公曆與農曆日期對照表」年表（官方历法数据），
 * 逐日推导大小月与闰月，不复制任何第三方实现的数据。
 * 生成命令：node tools/derive-lunar-table.mjs <HKO文本目录> src/providers/china/lunar-data.ts
 *
 * 每条形如 0x1_0000 的 17 位编码：
 *   bit16        闰月天数：1 = 30 天，0 = 29 天（无闰月时无意义）
 *   bit15..bit4  正月…十二月大小月：1 = 30 天（大月），0 = 29 天（小月）
 *   bit3..bit0   闰月月份：0 = 无闰月，1–12 = 闰几月（插在该月之后）
 */

/** 首个登记的农历年（1901 年正月初一 = 1901-02-19）。 */
export const LUNAR_FIRST_YEAR = ${entries[0].lunarYear};

/** 末个登记的农历年。 */
export const LUNAR_LAST_YEAR = ${entries[entries.length - 1].lunarYear};

/** 农历 1901–2099 年数据，索引 = 农历年 − LUNAR_FIRST_YEAR。 */
export const LUNAR_YEAR_DATA: readonly number[] = [
`;

const body = entries
  .map((e) => {
    const hex = `0x${e.value.toString(16).padStart(5, "0")}`;
    const monthText = e.months
      .map((m, i) => `${m.isLeap ? "闰" : ""}${m.month}月${e.lengths[i]}`)
      .join(" ");
    return `  ${hex}, // ${e.lunarYear}：${monthText}`;
  })
  .join("\n");

writeFileSync(out, `${header}${body}\n];\n`, "utf8");
console.log(`已写入 ${out}`);

if (daysOut) {
  const rows = sorted.map((date) => [date, days.get(date)]);
  writeFileSync(daysOut, JSON.stringify(rows), "utf8");
  console.log(`已写入校验数据 ${daysOut}（${rows.length} 天）`);
}
