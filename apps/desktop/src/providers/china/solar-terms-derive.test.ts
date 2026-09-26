// @vitest-environment node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SOLAR_TERMS, solarTermOfKey } from "./solar-terms";
import {
  SOLAR_TERM_DAY_DATA,
  SOLAR_TERM_FIRST_YEAR,
  SOLAR_TERM_LAST_YEAR,
} from "./solar-terms-data";

/**
 * 节气数据推导工具测试（SC-012 验收：24 节气日期可正确生成 / 读取）。
 *
 * 已提交的 `solar-terms-data.ts` 由 `tools/derive-solar-terms.mjs` 一次性生成，
 * 因此「读取」（`solarTermOfKey`）有测试、「生成」一直没有：重跑工具若读错年表，
 * 已提交的数据与读它的测试都不会变红，错误只会在下一次重新生成时静默进入仓库。
 * 本文件把「生成」这一步也变成可执行的：
 *
 * - 输入是**手写的年表片段**，格式照抄香港天文台「公曆與農曆日期對照表」年表
 *   （UTF-8 BOM、CRLF、`公曆日期 農曆日期 星期 節氣` 四列，日期行以 `YYYY年M月D日`
 *   开头），日期取自年表的「節氣」列，不是从已提交的表反推——否则工具与数据
 *   互相证明，等于没测；
 * - 断言输出的年份范围、24 个日期与文件头（节气清单与数据来源口径），再用应用
 *   自己的 `solarTermOfKey` 把生成的日期逐条读回来：生成的行必须能被读取方按
 *   序号认出，工具与 Provider 的清单顺序不能各说各话；
 * - 断言失败路径：缺项、月份错位、日期越界、同年重复、年份不连续都以非零退出码
 *   失败，且不写出输出文件——生成失败不能覆盖已提交的好数据。
 *
 * 已提交的表另有两道锁：2026 行与生成结果一致（工具改坏了会红），以及 200 行的
 * 摘要与年份范围（手改任何一年都必须重新生成并更新摘要）。年表文本不随仓库分发，
 * 因此「表与官方年表一致」无法在测试里离线复核——它靠重新生成时核对：
 * 2026-09-25 用 1901–2100 全部 200 份年表重跑，输出与已提交的表逐字节一致。
 */

const TOOL = fileURLToPath(
  new URL("../../../tools/derive-solar-terms.mjs", import.meta.url),
);

/** 节气清单：顺序即序号，名称用年表里的繁体写法（与工具同名）。 */
const TERM_NAMES = [
  "小寒",
  "大寒",
  "立春",
  "雨水",
  "驚蟄",
  "春分",
  "清明",
  "穀雨",
  "立夏",
  "小滿",
  "芒種",
  "夏至",
  "小暑",
  "大暑",
  "立秋",
  "處暑",
  "白露",
  "秋分",
  "寒露",
  "霜降",
  "立冬",
  "小雪",
  "大雪",
  "冬至",
];

/** 年表里的 2025 / 2026 / 2027 节气日期。 */
const DAYS_2025 = [
  5, 20, 3, 18, 5, 20, 4, 20, 5, 21, 5, 21, 7, 22, 7, 23, 7, 23, 8, 23, 7, 22,
  7, 21,
];
const DAYS_2026 = [
  5, 20, 4, 18, 5, 20, 5, 20, 5, 21, 5, 21, 7, 23, 7, 23, 7, 23, 8, 23, 7, 22,
  7, 22,
];
const DAYS_2027 = [
  5, 20, 4, 19, 6, 21, 5, 20, 6, 21, 6, 21, 7, 23, 8, 23, 8, 23, 8, 23, 7, 22,
  7, 22,
];

/** 农历日期列与星期列：年表里与「節氣」相邻的两列，工具不读，取值只为像真的年表。 */
const LUNAR_DAY_NAMES = ["初一", "十五", "廿三", "廿八"];
const WEEKDAYS = [
  "星期日",
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 年表片段里的一行：第几个节气（0 起，决定节气名与月份）+ 写在哪一天。 */
interface YearRow {
  position: number;
  month: number;
  day: number;
}

/** 序号 → 公历月：节气与月份的对应是固定的（小寒 / 大寒在一月，依此类推）。 */
function monthOf(position: number): number {
  return Math.ceil((position + 1) / 2);
}

/**
 * 一份年表片段：`rows` 里没给的节气不写这一行（用于构造缺项 / 重复的坏输入），
 * 月份由调用方给（用于构造月份错位）。另加一行没有节气的普通日期，
 * 证明工具不会把非节气行算进来。
 */
function hkoYearText(year: number, rows: readonly YearRow[]): string {
  const lines = [
    // 真实年表的标题带干支与生肖，工具只读日期行，因此这里不假装抄一份。
    `${year}年公曆與農曆日期對照表`,
    "",
    "公曆日期              農曆日期    星期        節氣",
    `${year}年1月1日          十三        星期四              `,
  ];
  for (const { position, month, day } of rows) {
    lines.push(
      `${year}年${month}月${day}日          ${LUNAR_DAY_NAMES[position % LUNAR_DAY_NAMES.length]}        ${WEEKDAYS[position % WEEKDAYS.length]}      ${TERM_NAMES[position]}    `,
    );
  }
  // 真实年表带 BOM 与 CRLF，片段照抄这个形态。
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** 一个公历年完整的 24 行（按序号），日期取 `days`，月份由序号决定。 */
function fullYear(days: readonly number[]): YearRow[] {
  return TERM_NAMES.map((_, position) => ({
    position,
    month: monthOf(position),
    day: days[position],
  }));
}

interface ToolRun {
  status: number | null;
  stdout: string;
  output: string | null;
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "solar-terms-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** 把年表片段写进临时目录，跑一次工具，读回 stdout 与（可能不存在的）输出文件。 */
function runTool(files: ReadonlyArray<readonly [number, string]>): ToolRun {
  const inputDir = path.join(workDir, "hko");
  mkdirSync(inputDir, { recursive: true });
  for (const [year, text] of files) {
    writeFileSync(path.join(inputDir, `T${year}c.txt`), text);
  }

  const outFile = path.join(workDir, "out.ts");
  const result = spawnSync(process.execPath, [TOOL, inputDir, outFile], {
    encoding: "utf8",
    // 工具是同步脚本，卡住时不该把整个测试套件一起拖住。
    timeout: 30_000,
  });
  return {
    status: result.status,
    stdout: `${result.stdout}${result.stderr}`,
    output: existsSync(outFile) ? readFileSync(outFile, "utf8") : null,
  };
}

/** 输出文件里那一年的日期行：`  [5, 20, …], // 2026`。 */
function rowOf(output: string, year: number): number[] {
  const line = output
    .split("\n")
    .find((candidate) => candidate.trimEnd().endsWith(`// ${year}`));
  expect(line, `输出里应有 ${year} 年的一行`).toBeDefined();
  const numbers = line!.match(/\[([\d, ]+)\]/);
  expect(numbers, `${year} 年那一行应是数字数组`).not.toBeNull();
  return numbers![1].split(",").map((value) => Number(value.trim()));
}

describe("节气表推导工具（SC-012 验收：24 节气日期可正确生成）", () => {
  it("单年片段：年份范围、24 个日期与节气清单都对得上", () => {
    const run = runTool([[2026, hkoYearText(2026, fullYear(DAYS_2026))]]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("覆盖 1 年：2026 → 2026");
    expect(run.stdout).toContain("数据问题 0 条");

    const output = run.output!;
    expect(output).toContain("export const SOLAR_TERM_FIRST_YEAR = 2026;");
    expect(output).toContain("export const SOLAR_TERM_LAST_YEAR = 2026;");
    // 文件头是数据出处的口径：换来源或换生成方式，这里会先红。
    expect(output).toContain(
      "香港天文台「公曆與農曆日期對照表」年表的「節氣」列",
    );
    expect(output).toContain(
      TERM_NAMES.map((name, index) => `${index + 1} ${name}`).join(" · "),
    );
    expect(rowOf(output, 2026)).toEqual(DAYS_2026);
  });

  it("生成的日期能被应用自己读回来：序号、月份与清单一致", () => {
    const run = runTool([[2026, hkoYearText(2026, fullYear(DAYS_2026))]]);
    const days = rowOf(run.output!, 2026);

    expect(days).toHaveLength(SOLAR_TERMS.length);
    for (const [position, day] of days.entries()) {
      const term = solarTermOfKey(`2026-${pad(monthOf(position))}-${pad(day)}`);
      expect([position + 1, term?.index, term?.name]).toEqual([
        position + 1,
        position + 1,
        SOLAR_TERMS[position].name,
      ]);
    }
  });

  it("已提交的 2026 行就是这份输入生成的结果", () => {
    const run = runTool([[2026, hkoYearText(2026, fullYear(DAYS_2026))]]);

    const committed = SOLAR_TERM_DAY_DATA[2026 - SOLAR_TERM_FIRST_YEAR];
    expect(rowOf(run.output!, 2026)).toEqual([...committed]);
  });

  it("已提交的 200 行整体锁定：改任何一年都要重新生成并显式更新摘要", () => {
    // 年表文本不随仓库分发，「表与年表一致」只能在重新生成时核对（见文件头）；
    // 这里锁的是另一半——已提交的表不能被手改：任何一处改动都会让摘要变化，
    // 要改就得重新生成、并显式更新这个值。摘要是变更探测器，不是正确性证明。
    const digest = createHash("sha256")
      .update(SOLAR_TERM_DAY_DATA.map((row) => row.join(",")).join(";"))
      .digest("hex");
    expect(digest).toBe(
      "1cd168b8e63a3d6a68782575bbd6997e0a1fad6c5cebe548f9919e792dec2474",
    );
    expect([SOLAR_TERM_FIRST_YEAR, SOLAR_TERM_LAST_YEAR]).toEqual([1901, 2100]);
    expect(SOLAR_TERM_DAY_DATA).toHaveLength(200);
  });

  it("连续两年：两行按年排列，年份范围取首末年", () => {
    const run = runTool([
      [2025, hkoYearText(2025, fullYear(DAYS_2025))],
      [2026, hkoYearText(2026, fullYear(DAYS_2026))],
    ]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("覆盖 2 年：2025 → 2026");

    const output = run.output!;
    expect(output).toContain("export const SOLAR_TERM_FIRST_YEAR = 2025;");
    expect(output).toContain("export const SOLAR_TERM_LAST_YEAR = 2026;");
    expect(rowOf(output, 2025)).toEqual(DAYS_2025);
    expect(rowOf(output, 2026)).toEqual(DAYS_2026);
  });

  it("缺一个节气：拒绝生成，也不写出输出文件", () => {
    const missing = fullYear(DAYS_2026).slice(0, 23);
    const run = runTool([[2026, hkoYearText(2026, missing)]]);

    expect(run.status).toBe(1);
    // 失败的年份不进表：一年都不通过时也必须报出原因，而不是在报告前崩掉。
    expect(run.stdout).toContain("覆盖 0 年：没有一年通过校验");
    expect(run.stdout).toContain("2026 年只有 23 个节气");
    expect(run.stdout).toContain("没有任何一年的 24 个节气是齐的");
    expect(run.stdout).not.toContain("TypeError");
    expect(run.output).toBeNull();
  });

  it("节气落在错的月份：报出实际月份与应有月份", () => {
    // 立春（序号 2，应为 2 月）写到 3 月 4 日。
    const wrongMonth = fullYear(DAYS_2026).map((row) =>
      row.position === 2 ? { position: 2, month: 3, day: 4 } : row,
    );
    const run = runTool([[2026, hkoYearText(2026, wrongMonth)]]);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("2026 年 立春 落在 3 月（应为 2 月）");
    expect(run.output).toBeNull();
  });

  it("节气日期超出常见范围：报出日期与窗口", () => {
    // 寒露（序号 18）写到 10 月 20 日（窗口是 7–9 日）。
    const outOfRange = fullYear(DAYS_2026).map((row) =>
      row.position === 18 ? { position: 18, month: 10, day: 20 } : row,
    );
    const run = runTool([[2026, hkoYearText(2026, outOfRange)]]);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("2026 年 寒露 日期 20 超出常见范围 7–9");
    expect(run.output).toBeNull();
  });

  it("同一年出现两次同一个节气：报重复", () => {
    const duplicated = [
      ...fullYear(DAYS_2026),
      { position: 0, month: 1, day: 5 },
    ];
    const run = runTool([[2026, hkoYearText(2026, duplicated)]]);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("2026 年 小寒 出现两次");
    expect(run.output).toBeNull();
  });

  it("年份不连续：拒绝生成（缺一年的表不能让下游以为覆盖完整）", () => {
    const run = runTool([
      [2025, hkoYearText(2025, fullYear(DAYS_2025))],
      [2027, hkoYearText(2027, fullYear(DAYS_2027))],
    ]);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("年份不连续：共 2 年，应有 3 年");
    expect(run.output).toBeNull();
  });
});
