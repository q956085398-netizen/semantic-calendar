// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPETITIONS } from "./providers/football/competitions";
import { footballCatalog } from "./providers/football/football-catalog";
import { FESTIVALS } from "./providers/china/festivals";
import { HOLIDAY_ARRANGEMENTS } from "./providers/china/holidays-data";
import { SOLAR_TERMS } from "./providers/china/solar-terms";

/**
 * 边界守卫：UI 不承载领域知识（SC-009 验收 / app-spec §7.6）。
 *
 * 这条规则靠代码评审容易漏：一旦有人在月视图里写 if (title.includes("Arsenal"))
 * 或把队名当常量写进组件，识别与展示的分层就被破坏了。这里把它变成可执行的
 * 断言，共三条：
 *
 * 1. **领域名称不进 UI**——球队 / 联赛 / 传统节日 / 节气 / 法定节假日的名称、
 *    别名与稳定 ID 都不允许出现在 UI 源码里（假期名按通知文号登记、只有名字）；
 *    它们只能从 Provider 出发、经 Resolver 与日级载荷到达组件（§7.4 / §7.5）。
 * 2. **UI 不通过事件文本自行判断业务语义**——§7.6 的原话是
 *    「UI 不允许通过 title.includes(...) 自行判断业务语义」，因此事件文本字段
 *    （title / normalizedTitle / description / location）上的判定型字符串操作
 *    本身就是违规：要判断的内容必须先去 Matcher。原样渲染、真值判断与
 *    `?.trim()` 这类展示处理不在禁止之列。
 * 3. **UI 不直接 import Provider 目录**——元数据必须来自 Resolver 的输出（§7.5）。
 *
 * 守卫读的是源码原文，注释也算——引用领域名称的注释会被拦（把说法换成
 * 「假期名」这种不带名字的表述即可），这样规则只有一条，不需要理解语法。
 * 名称与判定这两条规则各有「牙齿」测试：把违规写法喂给判定函数，它必须报出来，
 * 否则守卫本身失效而无人察觉。
 *
 * 已知边界：判定规则认的是同一条语句里的字段名与判定操作（字段直接跟操作，或
 * 中间隔着括号、可选链与展示处理），改名后的局部变量、`event["title"]` 这类
 * 写法不在范围内——它是评审的抓手，不是数据流证明；能绕过它的写法同样绕不过评审。
 *
 * 扫描范围用“排除法”而不是白名单：src/ 下除少数非 UI 目录外全部扫描，
 * 这样新增 UI 目录或子目录会自动被覆盖，不会悄悄漏检。守卫放在 src/ 根下
 * （而不是某个 Provider 目录里）：它守的是核心分层，不是某一家的数据。
 */

const SRC_ROOT = path.dirname(fileURLToPath(import.meta.url));

/** 非 UI 层：数据、解析、标准化、偏好规则、语义与 Provider 自身的实现目录。 */
const NON_UI_DIRS = [
  // bench/ 是性能基线的固定工作负载（SC-020）：它刻意从真实目录取球队名
  // 构造可命中的输入，既不是 UI 也不进应用包，因此与 Provider 目录同类。
  // 只排除必须排除的目录——scheduling/ 这类通用原语照常扫描。
  "bench",
  "data",
  "format",
  "ics",
  "normalize",
  "providers",
  "semantic",
  // settings/ 是偏好规则（取值域与读取边界），不是 UI 组件——组件在 layout/ 与
  // calendar/ 下。把内置来源开关接到视图的 semantic/app-builtin-sources.ts 会
  // import 它，因此这里按实际分层排除，而不是让守卫把领域规则当成 UI 扫。
  "settings",
];

/**
 * 事件文本字段（§7.6 的 title 及其同类）。
 * 名字与其他记录同名的情形（如 CalendarSource.description）会被一并拦下——
 * 宁可让人确认一次，也不要放过一条真正的领域判断。
 */
const EVENT_TEXT_FIELDS = [
  "title",
  "normalizedTitle",
  "description",
  "location",
] as const;

/**
 * 判定型字符串操作：出现即说明这段 UI 代码在事件文本里找东西。
 * 只列「判断内容」的操作（切分同样是把文本当结构解析），排序 / 真值判断不算。
 * matchAll 必须排在 match 前面：正则交替先命中者胜。
 */
const JUDGMENT_OPS = [
  "includes",
  "startsWith",
  "endsWith",
  "indexOf",
  "lastIndexOf",
  "matchAll",
  "match",
  "search",
  "split",
] as const;

interface UiSource {
  file: string;
  source: string;
}

/** UI 里出现 `from "...providers/..."` 即为越界（守卫的牙齿测试也用它）。 */
const PROVIDER_IMPORT_PATTERN = /from\s+"[^"]*providers\//;

function relPath(file: string): string {
  return path.relative(SRC_ROOT, file).split(path.sep).join("/");
}

function collectUiSources(): UiSource[] {
  const files: string[] = [];
  for (const entry of readdirSync(SRC_ROOT, { withFileTypes: true })) {
    if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      files.push(path.join(SRC_ROOT, entry.name));
    } else if (entry.isDirectory() && !NON_UI_DIRS.includes(entry.name)) {
      files.push(...collectSources(path.join(SRC_ROOT, entry.name)));
    }
  }
  return files
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .map((file) => ({
      file: relPath(file),
      source: readFileSync(file, "utf8"),
    }));
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

describe("UI 不承载领域知识（SC-009 验收 / app-spec §7.6）", () => {
  const sources = collectUiSources();

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

  it("名称清单确实来自领域数据（守卫不会因为清单为空而空转）", () => {
    // 清单全部从数据推导，不另抄一份；这里只钉住「推导出来的是真名字」。
    // 规模只做下限保护：条数随球队与别名增减，钉死数字会让维护数据的人改测试。
    expect(teamNeedles().length).toBeGreaterThan(50);
    expect(teamNeedles()).toContain("Arsenal");
    expect(competitionNeedles()).toContain("Premier League");
    expect(daySemanticNeedles()).toContain("中秋节");
    expect(daySemanticNeedles()).toContain("寒露");
    expect(holidayNeedles()).toContain("国庆节");
  });

  it("球队名称、别名与稳定 ID 不出现在 UI 源码中（SC-014 验收：球队元数据不硬编码）", () => {
    expect(nameOffenders(sources, teamNeedles())).toEqual([]);
  });

  it("联赛完整名称不出现在 UI 源码中", () => {
    // 联赛短标签（“英超”）不在此列：侧栏的内置数据源行就叫这个名字
    // （SC-016 / SC-018 接线前是静态占位行）。那是数据源行的展示名，
    // 不参与事件内容判定；完整名称与英文名依然受检查。
    expect(nameOffenders(sources, competitionNeedles())).toEqual([]);
  });

  it("节日 / 节气名称与 id 不出现在 UI 源码中（SC-012 验收：Provider 不决定 UI）", () => {
    // 与球队名同一条规则：日期格里的「中秋节」「寒露」只能来自
    // app-china-festivals 的展示载荷，不能写进组件。
    expect(nameOffenders(sources, daySemanticNeedles())).toEqual([]);
  });

  it("法定节假日名称不出现在 UI 源码中（SC-011 验收：休 / 补由载荷给出）", () => {
    // 假期名（含「国庆节、中秋节」这类合并写法）按通知原文登记，
    // 月格与详情栏拿到的是载荷里的 label，因此名字同样不该进 UI。
    expect(nameOffenders(sources, holidayNeedles())).toEqual([]);
  });

  it("UI 不对事件文本做判定型字符串操作（§7.6：判定必须留在 Matcher）", () => {
    expect(judgmentOffenders(sources)).toEqual([]);
  });

  it("判定规则拦得住 §7.6 的写法（守卫的牙齿）", () => {
    expect(
      judgmentOffenders([
        {
          file: "calendar/Example.tsx",
          source: 'if (event.title.includes("Arsenal")) {',
        },
      ]),
    ).toEqual(["calendar/Example.tsx 对 title 使用 includes（§7.6）"]);
    // 可选链、括号、展示处理后接判定，以及同类操作（前后缀 / 正则 / 切分）一律拦下。
    expect(
      judgmentOffenders([
        { file: "a.ts", source: 'event.title?.startsWith("Arse")' },
        { file: "b.ts", source: "location.match(/主场/) !== null" },
        {
          file: "c.ts",
          source: 'const [home] = stored.normalizedTitle.split(" vs ");',
        },
        { file: "d.ts", source: "event.description.search(KEYWORDS) >= 0" },
        { file: "e.ts", source: 'event.title.toLowerCase().includes("vs")' },
        { file: "f.ts", source: "(event.location).indexOf(VENUE) >= 0" },
        { file: "g.ts", source: "for (const m of title.matchAll(PATTERN)) {}" },
      ]),
    ).toHaveLength(7);
    // 同一个文件里的多条违规全部报出，不是只报第一条。
    expect(
      judgmentOffenders([
        {
          file: "h.ts",
          source: 'title.includes("a");\nlocation.startsWith("b");',
        },
      ]),
    ).toEqual([
      "h.ts 对 title 使用 includes（§7.6）",
      "h.ts 对 location 使用 startsWith（§7.6）",
    ]);
    // 反面：原样渲染、真值判断与展示处理都不是判定。
    expect(
      judgmentOffenders([
        { file: "a.tsx", source: '{event.title || "（无标题）"}' },
        {
          file: "b.ts",
          source: "const title = event.normalizedTitle?.trim();",
        },
        { file: "c.ts", source: "return event.location?.trim();" },
      ]),
    ).toEqual([]);
  });

  it("名称与目录依赖规则拦得住违规写法（守卫的牙齿）", () => {
    expect(
      nameOffenders(
        [{ file: "layout/Example.tsx", source: 'const MARK = "Arsenal";' }],
        ["Arsenal"],
      ),
    ).toEqual(["layout/Example.tsx 出现「Arsenal」"]);
    expect(
      providerImportOffenders([
        {
          file: "calendar/Example.tsx",
          source:
            'import { footballCatalog } from "../providers/football/football-catalog";',
        },
      ]),
    ).toEqual(["calendar/Example.tsx 直接 import Provider 目录"]);
  });

  it("UI 不直接依赖 Provider 目录（元数据必须来自 Resolver 输出）", () => {
    expect(providerImportOffenders(sources)).toEqual([]);
  });
});

/** 清单去重：同一支球队的名字与 id、中文名与别名可能同词，重复只会重复报错。 */
function uniqueNeedles(needles: readonly string[]): string[] {
  return [...new Set(needles)];
}

/** 球队名、中文名、稳定 ID 与别名（SC-014 目录是唯一来源）。 */
function teamNeedles(): string[] {
  return uniqueNeedles(
    footballCatalog.teams.flatMap((team) => [
      team.name,
      team.nameZh,
      team.id,
      ...team.aliases,
    ]),
  );
}

/** 联赛完整名称与英文名；短标签是数据源行的展示名，不受检查。 */
function competitionNeedles(): string[] {
  return uniqueNeedles(
    COMPETITIONS.flatMap((competition) => [
      competition.name,
      competition.nameEn,
    ]),
  );
}

/** 传统节日与二十四节气的名称 / 英文名 / 稳定 ID（SC-012）。 */
function daySemanticNeedles(): string[] {
  return uniqueNeedles([
    ...FESTIVALS.flatMap((festival) => [
      festival.id,
      festival.name,
      festival.nameEn,
    ]),
    ...SOLAR_TERMS.flatMap((term) => [term.id, term.name, term.nameEn]),
  ]);
}

/**
 * 法定节假日名称（SC-011）：按通知原文登记（「国庆节、中秋节」这类合并写法就在
 * 这一份数据里）。假期行只有名字，没有别名与稳定 ID。
 */
function holidayNeedles(): string[] {
  return uniqueNeedles(
    HOLIDAY_ARRANGEMENTS.flatMap((arrangement) =>
      arrangement.items.flatMap((item) => item.names),
    ),
  );
}

function nameOffenders(
  sources: readonly UiSource[],
  needles: readonly string[],
): string[] {
  const offenders: string[] = [];
  for (const needle of needles) {
    const lower = needle.toLowerCase();
    for (const source of sources) {
      if (source.source.toLowerCase().includes(lower)) {
        offenders.push(`${source.file} 出现「${needle}」`);
      }
    }
  }
  return offenders;
}

/** UI 直接 import Provider 目录（§7.5：元数据只能来自 Resolver 的输出）。 */
function providerImportOffenders(sources: readonly UiSource[]): string[] {
  return sources
    .filter((source) => PROVIDER_IMPORT_PATTERN.test(source.source))
    .map((source) => `${source.file} 直接 import Provider 目录`);
}

/**
 * 事件文本字段上的判定型字符串操作（§7.6）。
 * 认的是同一条语句里的字段名与判定操作——字段直接跟操作，或中间隔着括号、
 * 可选链与展示处理（`title?.includes(...)`、`(title).indexOf(...)`、
 * `title.toLowerCase().includes(...)`）。改名后的局部变量不在范围内，
 * 见文件头的已知边界。
 */
function judgmentOffenders(sources: readonly UiSource[]): string[] {
  const field = EVENT_TEXT_FIELDS.join("|");
  const ops = JUDGMENT_OPS.join("|");
  const pattern = new RegExp(
    `\\b(${field})\\b[^;\\n]{0,60}?\\.\\s*(${ops})\\s*\\(`,
    "g",
  );

  const offenders = new Set<string>();
  for (const source of sources) {
    for (const match of source.source.matchAll(pattern)) {
      const [, fieldName, op] = match;
      offenders.add(`${source.file} 对 ${fieldName} 使用 ${op}（§7.6）`);
    }
  }
  return [...offenders];
}
