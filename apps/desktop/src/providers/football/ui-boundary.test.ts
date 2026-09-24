// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPETITIONS } from "./competitions";
import { footballCatalog } from "./football-catalog";
import { FESTIVALS } from "../china/festivals";
import { SOLAR_TERMS } from "../china/solar-terms";

/**
 * 边界守卫（SC-014 验收：“球队元数据不硬编码在 UI”）。
 *
 * 这条规则靠代码评审容易漏：一旦有人在月视图里写 if (title.includes("Arsenal"))
 * 或把队名当常量写进组件，识别与展示的分层就被破坏了。这里把它变成
 * 可执行的断言——UI 组件源码里不允许出现任何球队名称 / 别名 / 稳定 ID，
 * 也不允许直接 import Provider 目录；UI 只能消费 Resolver 输出的元数据。
 *
 * 扫描范围用“排除法”而不是白名单：src/ 下除少数非 UI 目录外全部扫描，
 * 这样新增 UI 目录或子目录会自动被覆盖，不会悄悄漏检。
 */

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** 非 UI 层：数据、解析、标准化、语义与 Provider 自身的实现目录。 */
const NON_UI_DIRS = [
  "data",
  "format",
  "ics",
  "normalize",
  "providers",
  "semantic",
];

function relPath(file: string): string {
  return path.relative(SRC_ROOT, file).split(path.sep).join("/");
}

function collectUiSources(): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(SRC_ROOT, { withFileTypes: true })) {
    if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      files.push(path.join(SRC_ROOT, entry.name));
    } else if (entry.isDirectory() && !NON_UI_DIRS.includes(entry.name)) {
      files.push(...collectSources(path.join(SRC_ROOT, entry.name)));
    }
  }
  return files.filter((file) => !/\.test\.tsx?$/.test(file));
}

function collectSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSources(absolute));
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files;
}

describe("UI 不承载领域知识（SC-014 验收 / app-spec §7.6）", () => {
  const sources = collectUiSources().map((file) => ({
    file: relPath(file),
    lower: readFileSync(file, "utf8").toLowerCase(),
  }));

  it("扫描范围覆盖全部 UI 组件（防止守卫本身失效）", () => {
    const scanned = sources.map((source) => source.file);
    expect(scanned).toEqual(
      expect.arrayContaining([
        "App.tsx",
        "main.tsx",
        "layout/AppShell.tsx",
        "layout/InspectorPanel.tsx",
        "layout/Sidebar.tsx",
        "calendar/MonthView.tsx",
        "calendar/MiniMonth.tsx",
      ]),
    );
    // 非 UI 目录必须被排除，否则守卫会被自己的实现目录污染。
    expect(scanned.some((file) => file.startsWith("providers/"))).toBe(false);
    expect(scanned.some((file) => file.startsWith("data/"))).toBe(false);
  });

  it("球队名称、别名与稳定 ID 不出现在 UI 源码中（验收：球队元数据不硬编码）", () => {
    const needles = footballCatalog.teams.flatMap((team) => [
      team.name,
      team.nameZh,
      team.id,
      ...team.aliases,
    ]);
    expect(findOffenders(sources, needles)).toEqual([]);
  });

  it("联赛完整名称不出现在 UI 源码中", () => {
    // 联赛短标签（“英超”）不在此列：侧栏的内置数据源行就叫这个名字
    // （SC-016 / SC-018 接线前是静态占位行）。那是数据源行的展示名，
    // 不参与事件内容判定；完整名称与英文名依然受检查。
    const needles = COMPETITIONS.flatMap((competition) => [
      competition.name,
      competition.nameEn,
    ]);
    expect(findOffenders(sources, needles)).toEqual([]);
  });

  it("UI 不直接依赖 Provider 目录（元数据必须来自 Resolver 输出）", () => {
    const offenders = sources
      .filter((source) => /from\s+"[^"]*providers\//.test(source.lower))
      .map((source) => source.file);
    expect(offenders).toEqual([]);
  });

  it("节日 / 节气名称与 id 不出现在 UI 源码中（SC-012 验收：Provider 不决定 UI）", () => {
    // 与球队名同一条规则：日期格里的「中秋节」「寒露」只能来自
    // app-china-festivals 的展示载荷，不能写进组件。
    const needles = [
      ...FESTIVALS.flatMap((festival) => [
        festival.id,
        festival.name,
        festival.nameEn,
      ]),
      ...SOLAR_TERMS.flatMap((term) => [term.id, term.name, term.nameEn]),
    ];
    expect(findOffenders(sources, needles)).toEqual([]);
  });
});

function findOffenders(
  sources: readonly { file: string; lower: string }[],
  needles: readonly string[],
): string[] {
  const offenders: string[] = [];
  for (const needle of needles) {
    const lower = needle.toLowerCase();
    for (const source of sources) {
      if (source.lower.includes(lower)) {
        offenders.push(`${source.file} 出现「${needle}」`);
      }
    }
  }
  return offenders;
}
