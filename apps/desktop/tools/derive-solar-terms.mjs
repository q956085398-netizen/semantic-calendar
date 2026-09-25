// 从香港天文台官方对照表推导二十四节气日期表（1901–2100）。
// 用法：node derive-solar-terms.mjs <hko目录> <输出 ts 路径>
//
// 数据来源：香港天文台「公曆與農曆日期對照表」年表的「節氣」列
//   https://www.hko.gov.hk/tc/gts/time/calendar/text/files/T<年>c.txt
//   年表文本不随仓库分发，重跑前需先把 T1901c.txt–T2100c.txt 下载到 <hko目录>
//   （与 derive-lunar-table.mjs 用的是同一批文件）。
// 输出：每个公历年一条 24 个数字的数组，数字是该节气所在的公历日；
// 月份由节气序号决定（小寒 / 大寒在一月，立春 / 雨水在二月，依此类推），
// 因此不需要逐条存月份。节气名与序号见 src/providers/china/solar-terms.ts。
//
// 这里是繁体名表（HKO 年表用繁体），展示口径以
// src/providers/china/solar-terms.ts 的简体名为准；两边改动要一起改。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const out = process.argv[3];
if (!dir || !out) {
  console.error("用法：node derive-solar-terms.mjs <hko目录> <输出 ts 路径>");
  process.exit(1);
}

/** 节气序号与名称：小寒 = 1，冬至 = 24（与 solar-terms.ts 同序）。 */
const TERMS = [
  { name: "小寒", month: 1, min: 4, max: 7 },
  { name: "大寒", month: 1, min: 19, max: 21 },
  { name: "立春", month: 2, min: 3, max: 5 },
  { name: "雨水", month: 2, min: 18, max: 20 },
  { name: "驚蟄", month: 3, min: 4, max: 7 },
  { name: "春分", month: 3, min: 19, max: 22 },
  { name: "清明", month: 4, min: 4, max: 6 },
  { name: "穀雨", month: 4, min: 19, max: 21 },
  { name: "立夏", month: 5, min: 4, max: 7 },
  { name: "小滿", month: 5, min: 20, max: 22 },
  { name: "芒種", month: 6, min: 4, max: 7 },
  { name: "夏至", month: 6, min: 20, max: 22 },
  { name: "小暑", month: 7, min: 6, max: 8 },
  { name: "大暑", month: 7, min: 22, max: 24 },
  { name: "立秋", month: 8, min: 6, max: 9 },
  { name: "處暑", month: 8, min: 22, max: 24 },
  { name: "白露", month: 9, min: 6, max: 9 },
  { name: "秋分", month: 9, min: 22, max: 24 },
  { name: "寒露", month: 10, min: 7, max: 9 },
  { name: "霜降", month: 10, min: 22, max: 24 },
  { name: "立冬", month: 11, min: 6, max: 8 },
  { name: "小雪", month: 11, min: 21, max: 23 },
  { name: "大雪", month: 12, min: 6, max: 8 },
  { name: "冬至", month: 12, min: 21, max: 23 },
];

const files = readdirSync(dir)
  .filter((name) => /^T\d{4}c\.txt$/.test(name))
  .sort();
if (files.length === 0) {
  console.error(`${dir} 下没有 T<年>c.txt`);
  process.exit(1);
}

const entries = [];
const problems = [];

for (const file of files) {
  const year = Number(file.slice(1, 5));
  const text = readFileSync(path.join(dir, file), "utf8").replace(
    /^\uFEFF/,
    "",
  );
  const found = new Map();
  for (const line of text.split(/\r?\n/)) {
    const date = line.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (!date) continue;
    const term = TERMS.find((candidate) => line.includes(candidate.name));
    if (!term) continue;
    if (found.has(term.name)) {
      problems.push(`${year} 年 ${term.name} 出现两次`);
    }
    found.set(term.name, {
      month: Number(date[2]),
      day: Number(date[3]),
      term,
    });
  }

  if (found.size !== TERMS.length) {
    problems.push(`${year} 年只有 ${found.size} 个节气`);
    continue;
  }

  const days = [];
  let previousMonth = 0;
  for (const term of TERMS) {
    const hit = found.get(term.name);
    if (hit.month !== term.month) {
      problems.push(
        `${year} 年 ${term.name} 落在 ${hit.month} 月（应为 ${term.month} 月）`,
      );
    }
    if (hit.day < term.min || hit.day > term.max) {
      problems.push(
        `${year} 年 ${term.name} 日期 ${hit.day} 超出常见范围 ${term.min}–${term.max}`,
      );
    }
    if (hit.month < previousMonth) {
      problems.push(`${year} 年节气次序异常：${term.name}`);
    }
    previousMonth = hit.month;
    days.push(hit.day);
  }
  entries.push({ year, days });
}

// 报告先出、再由退出码决定成败：一年都没通过校验时也要把原因打出来
// （不能在这里读 entries[0] 崩掉——那样真正的问题会被一段栈顶替）。
console.log(
  entries.length === 0
    ? "覆盖 0 年：没有一年通过校验"
    : `覆盖 ${entries.length} 年：${entries[0].year} → ${entries[entries.length - 1].year}`,
);
if (entries.length === 0) {
  problems.push("没有任何一年的 24 个节气是齐的");
} else {
  const expectedYears = entries[entries.length - 1].year - entries[0].year + 1;
  if (entries.length !== expectedYears) {
    problems.push(
      `年份不连续：共 ${entries.length} 年，应有 ${expectedYears} 年`,
    );
  }
}
console.log(`数据问题 ${problems.length} 条`);
for (const problem of problems) console.log("  ", problem);
if (problems.length > 0) {
  process.exit(1);
}

const firstYear = entries[0].year;
const lastYear = entries[entries.length - 1].year;
const termList = TERMS.map((term, index) => `${index + 1} ${term.name}`).join(
  " · ",
);

const header = `/**
 * 二十四节气日期（solar-terms-data.ts）— 由 tools/derive-solar-terms.mjs 生成，请勿手改。
 *
 * 数据来源：香港天文台「公曆與農曆日期對照表」年表的「節氣」列（官方历法数据），
 * 与农历表（lunar-data.ts）取自同一批年表，不复制任何第三方实现的数据。
 * 生成命令：node tools/derive-solar-terms.mjs <HKO文本目录> src/providers/china/solar-terms-data.ts
 *
 * 每个公历年 24 个数字，依次为节气序号 1–24 所在的公历日：
 *   ${termList}
 * 月份由序号决定（小寒 / 大寒在一月，立春 / 雨水在二月，依此类推），
 * 因此只存日、不存月——节气名与月份映射见 solar-terms.ts 的 SOLAR_TERMS。
 *
 * 一行一年（已列入 .prettierignore）：200 年整表要能一眼扫完，
 * 而 Prettier 会把每一年折成四行，把「查一年的节气」变成跨行阅读。
 */

/** 首个登记的公历年。 */
export const SOLAR_TERM_FIRST_YEAR = ${firstYear};

/** 末个登记的公历年。 */
export const SOLAR_TERM_LAST_YEAR = ${lastYear};

/** ${firstYear}–${lastYear} 年节气日表，索引 = 公历年 − SOLAR_TERM_FIRST_YEAR。 */
export const SOLAR_TERM_DAY_DATA: readonly (readonly number[])[] = [
`;

const body = entries
  .map((entry) => `  [${entry.days.join(", ")}], // ${entry.year}`)
  .join("\n");

writeFileSync(out, `${header}${body}\n];\n`, "utf8");
console.log(`已写入 ${out}`);
