// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 设置契约（SC-018 验收的三条，app-spec §9 SETTINGS）。
 *
 * 这三条验收措辞在实现落地时只有零散的用例：主题、内置来源开关、刷新间隔、
 * 关闭行为各有「改了会怎样」的集成测试，但没有任何东西拦得住下面这类问题——
 *
 * 1. **所有 v0.1 偏好可持久化**：新增一条偏好只写了启动读取（用户永远改不动），
 *    或者只写了落盘（改完要等下一次启动才生效的“假状态”），或者启动读取不过
 *    归一化边界（坏值直接进内存）。这些都不是能靠既有用例发现的：既有用例只
 *    覆盖它们各自那一条键。
 * 2. **设置改动即时生效或明确提示需重启**：一个 handler 只调 persistSetting、
 *    不产生任何即时效果，用户点完界面不动，而界面也没说“需要重启”。
 * 3. **设置页面不演变为 Dashboard**：设置页要变成 Dashboard，第一步必然是
 *    import 事件数据或派生层（分桶、月格、统计）。把可 import 的模块收成
 *    白名单，这件事就从一个评审习惯变成一条断言。
 *
 * 扫描范围与口径：
 * - 设置键从源码里的 `export const *_SETTING_KEY = "命名空间.名字"` 声明收集，
 *   `App.tsx` 是唯一的读写方（预览模式之外没有第二个存储）；
 * - 改动入口认三种写法：`function handleXxx(...)`、`const handleXxx = useCallback(…)`
 *   与 `const handleXxx = (…) =>`，函数体按花括号配对截取；
 * - 白名单里的每一项都要写明理由，且必须真的在用：删掉 import 也要一并删掉
 *   授权，名单不会烂成一串“曾经允许”。
 *
 * 已知边界（它是评审的抓手，不是数据流证明）：
 * - 花括号在字符串与注释里必须成对，参数不能用对象解构（那会把参数当成函数体）；
 * - 启动读取的边界必须是紧邻写法 `read…/normalize…(store.getSetting(KEY))`：
 *   把读取抽成 `readPreferences(store)` 这类间接写法会被判成“没有边界”，
 *   那时改这里或改写法都行，但要让规则继续成立；
 * - 键名可以是单双引号、带类型标注或 `as const`，但值必须是字面量——否则
 *   `unreadableKeyDeclarations` 会报出来（宁可报一次，也不要让键悄悄离开注册表）。
 *
 * 每条规则各有一组「牙齿」测试：把违规写法喂给判定函数，它必须报出来——
 * 否则守卫自己失效也不会有人察觉。
 */

const SOURCE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const APP_PATH = path.join(SOURCE_DIR, "App.tsx");
const SETTINGS_PAGE_PATH = path.join(SOURCE_DIR, "layout", "SettingsView.tsx");
const APP_SOURCE = readFileSync(APP_PATH, "utf8");
const SETTINGS_PAGE_SOURCE = readFileSync(SETTINGS_PAGE_PATH, "utf8");

interface SourceFile {
  file: string;
  source: string;
}

interface SettingKey {
  /** 常量名，如 THEME_SETTING_KEY。 */
  constant: string;
  /** 快照里的键名，如 app.theme。 */
  value: string;
  /** 声明所在的文件（相对 src/）。 */
  file: string;
}

/** 递归收集 src/ 下的模块源码（测试文件不算：它们也写设置值的字面量）。 */
function collectModuleSources(
  directory: string,
  base = directory,
): SourceFile[] {
  const files: SourceFile[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectModuleSources(full, base));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      files.push({
        file: path.relative(base, full).split(path.sep).join("/"),
        source: readFileSync(full, "utf8"),
      });
    }
  }
  return files;
}

/**
 * 键声明：常量名与字面量键名。刻意收得宽（允许类型标注、`as const`、单双引号）
 * ——窄了会让新键悄悄离开注册表。另一半由 `unreadableKeyDeclarations` 兜住：
 * 认得一个 `*_SETTING_KEY` 的名字、却读不出键名，同样报错。
 */
const KEY_DECLARATION =
  /export const ([A-Z0-9_]+_SETTING_KEY)\b[^=]*=\s*["']([^"']+)["']/g;

function findSettingKeys(files: readonly SourceFile[]): SettingKey[] {
  const keys: SettingKey[] = [];
  for (const file of files) {
    for (const match of file.source.matchAll(KEY_DECLARATION)) {
      keys.push({ constant: match[1], value: match[2], file: file.file });
    }
  }
  return keys;
}

const KEY_NAME = /export const ([A-Z0-9_]+_SETTING_KEY)\b/g;

/** 声明了 `*_SETTING_KEY`、键名却不是字面量（注册表读不出来 ⇒ 会被漏掉）。 */
function unreadableKeyDeclarations(files: readonly SourceFile[]): string[] {
  const problems: string[] = [];
  for (const file of files) {
    const readable = new Set(
      [...file.source.matchAll(KEY_DECLARATION)].map((match) => match[1]),
    );
    for (const match of file.source.matchAll(KEY_NAME)) {
      if (!readable.has(match[1])) {
        problems.push(
          `${file.file} 的 ${match[1]} 读不出键名：注册表只认字面量声明，这条键会从核对里消失`,
        );
      }
    }
  }
  return problems;
}

/** 键名形态：命名空间.名字（快照 settings 分区不加前缀，因此命名空间在名字里）。 */
const SETTING_KEY_SHAPE = /^[a-z][a-zA-Z]*\.[a-zA-Z][a-zA-Z0-9]*$/;

function settingKeyShapeProblems(keys: readonly SettingKey[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const key of keys) {
    if (!SETTING_KEY_SHAPE.test(key.value)) {
      problems.push(
        `${key.file} 的 ${key.constant} 键名 ${key.value} 不是「命名空间.名字」形态`,
      );
    }
    const owner = seen.get(key.value);
    if (owner !== undefined) {
      problems.push(
        `键名 ${key.value} 被 ${owner} 与 ${key.constant} 重复声明`,
      );
    }
    seen.set(key.value, key.constant);
  }
  return problems;
}

/**
 * 一个键的三件套：写得进快照、启动读得回来、读取经过边界。
 * 缺任何一件都是一类真实故障：改不动 / 重启后失效 / 坏值进内存。
 */
function keyContractProblems(
  appSource: string,
  keys: readonly SettingKey[],
): string[] {
  const problems: string[] = [];
  for (const key of keys) {
    const { constant, value } = key;
    const written = new RegExp(
      `(?:persistSetting|setSetting)\\(\\s*${constant}\\b`,
    );
    const readBack = new RegExp(`store\\.getSetting\\(\\s*${constant}\\b`);
    const boundary = new RegExp(
      `(?:read|normalize)[A-Za-z]*\\(\\s*store\\.getSetting\\(\\s*${constant}\\s*\\)`,
    );
    if (!written.test(appSource)) {
      problems.push(
        `${constant}（${value}）没有写入路径：这条偏好改不动，也落不了盘`,
      );
    }
    if (!readBack.test(appSource)) {
      problems.push(
        `${constant}（${value}）没有启动读取：写进快照也不会在下次启动恢复（假状态）`,
      );
    } else if (!boundary.test(appSource)) {
      problems.push(
        `${constant}（${value}）的启动读取没经过读 / 归一化边界：坏值会直接进内存（P-03）`,
      );
    }
  }
  return problems;
}

/**
 * 设置读写的调用点与其第一个实参。允许显式类型参数（`store.getSetting<…>(…)`，
 * App.tsx 里读“上次启动”时间戳就是这样写的）——漏掉它会放过一整类写死的键名。
 */
const SETTING_CALL_ARGUMENT =
  /(?:store\.(?:get|set)Setting|persistSetting)(?:<[^>]*>)?\(\s*([^,)\n]+?)\s*[,)]/g;

/**
 * 允许出现在读写调用点的实参：
 * - 任何 `*_SETTING_KEY` 常量（登记在注册表里，逐键核对）；
 * - `key`：persistSetting 自己的形参，转发给 store.setSetting（不是选键）；
 * - `LAST_OPENED_SETTING`：应用状态而不是偏好（“上次启动”的时间戳），
 *   它没有界面控件、也不需要即时效果，因此不登记为偏好键。
 */
const ALLOWED_CALL_ARGUMENTS = ["key", "LAST_OPENED_SETTING"];

function literalKeyArgumentProblems(appSource: string): string[] {
  const problems: string[] = [];
  for (const match of appSource.matchAll(SETTING_CALL_ARGUMENT)) {
    const argument = match[1];
    if (/_SETTING_KEY$/.test(argument)) {
      continue;
    }
    if (ALLOWED_CALL_ARGUMENTS.includes(argument)) {
      continue;
    }
    problems.push(
      `App.tsx 用 ${argument} 作为设置键名：新偏好要登记成 *_SETTING_KEY 常量（写死的键名既进不了注册表，也会让旧快照读不出设置）`,
    );
  }
  return problems;
}

/**
 * 改动入口的三种写法都认：`function handleX(...)`、`const handleX = useCallback(…)`
 * 与 `const handleX = (…) =>`。函数体从签名之后的第一个花括号起按配对截取
 * （参数用了对象解构时第一个花括号是参数而不是函数体——这是已知边界，见文件头）。
 */
const HANDLER_START =
  /(?:function\s+(handle[A-Za-z0-9_]*)\s*\(|const\s+(handle[A-Za-z0-9_]*)\s*=\s*(?:useCallback\(\s*)?(?:async\s*)?\()/g;

/** 取 `handleXxx` 的函数体（按花括号配对，含头尾括号）。 */
function handlerBodies(
  appSource: string,
): Array<{ name: string; body: string }> {
  const handlers: Array<{ name: string; body: string }> = [];
  for (const match of appSource.matchAll(HANDLER_START)) {
    const name = match[1] ?? match[2];
    const open = appSource.indexOf("{", match.index);
    if (open === -1) {
      continue;
    }
    let depth = 0;
    for (let index = open; index < appSource.length; index += 1) {
      const char = appSource[index];
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          handlers.push({ name, body: appSource.slice(open, index + 1) });
          break;
        }
      }
    }
  }
  return handlers;
}

/** 即时效果：界面状态、主题应用、调度重排、指针更新或推给桌面壳。 */
function hasImmediateEffect(body: string): boolean {
  const setters = [...body.matchAll(/\bset[A-Z]\w*\(/g)]
    .map((match) => match[0])
    // setTimeout / setInterval 是调度原语，不是“界面已经变了”。
    .filter((name) => name !== "setTimeout(" && name !== "setInterval(");
  if (setters.length > 0) {
    return true;
  }
  return /\bapplyTheme\(|\breschedule\(\)|\.current\s*=|pushCloseBehavior\(/.test(
    body,
  );
}

/**
 * 改动即时生效（验收）：
 * - 写偏好的 handler 必须同时有落盘与即时效果——只落盘意味着「点完界面不动，
 *   重启才生效」，而设置页没有任何“需要重启”的提示；
 * - 每条偏好都要有一个改动入口：没有入口的偏好是死键，改不动。
 *
 * 「只能等重启」的设置今天一条都没有，因此这里不设例外清单，规则就是硬要求：
 * 真有那样一条设置时，应当**同时**加上界面提示并在这里放开（那条提示才是验收
 * 第二半句的证据，空清单本身证明不了什么）。去重日志不是用户选择，用
 * `nonPreference` 排除。
 */
function handlerImmediacyProblems(
  appSource: string,
  keys: readonly SettingKey[],
  options: { nonPreference?: readonly string[] } = {},
): string[] {
  const problems: string[] = [];
  const preferences = keys.filter(
    (key) => !(options.nonPreference ?? []).includes(key.value),
  );
  const written = new Set<string>();
  for (const handler of handlerBodies(appSource)) {
    const keysHere = preferences.filter((key) =>
      new RegExp(`(?:persistSetting|setSetting)\\(\\s*${key.constant}\\b`).test(
        handler.body,
      ),
    );
    if (keysHere.length === 0) {
      continue;
    }
    for (const key of keysHere) {
      written.add(key.value);
    }
    if (!hasImmediateEffect(handler.body)) {
      problems.push(
        `${handler.name} 只把设置写进快照，没有任何即时效果：改动要等下一次启动才生效，而界面没有说`,
      );
    }
  }
  for (const key of preferences) {
    if (!written.has(key.value)) {
      problems.push(
        `${key.constant}（${key.value}）没有任何改动入口写它（若入口确实存在，看看它是不是换了一种扫描认不出的写法）`,
      );
    }
  }
  return problems;
}

/** 设置页可以 import 的模块：偏好规则、展示原语与类型，逐条写明理由。 */
const SETTINGS_PAGE_IMPORTS: ReadonlyArray<{
  specifier: string;
  reason: string;
}> = [
  {
    specifier: "../data/model",
    reason:
      "来源类型与 WEBCAL_SOURCE_TYPE 常量：数据层的公开命名，不是事件数据",
  },
  {
    specifier: "../settings/app-info",
    reason: "「关于」的只读事实（名称 / 版本 / License）",
  },
  {
    specifier: "../settings/builtin-sources",
    reason: "内置来源开关的取值域与读取边界",
  },
  {
    specifier: "../settings/webcal-interval",
    reason: "刷新间隔的选项与口径说明",
  },
  { specifier: "../settings/region", reason: "区域预留的只读事实" },
  {
    specifier: "../shell/close-behavior",
    reason: "窗口关闭行为的选项与说明",
  },
  { specifier: "../theme/theme", reason: "主题取值（只借类型）" },
  {
    specifier: "../notifications/notification-settings",
    reason: "比赛提醒的取值域与选项",
  },
  {
    specifier: "../notifications/notification-bridge",
    reason: "通知权限状态（只借类型）",
  },
  {
    specifier: "./source-display",
    reason: "来源行状态文案与识别色（与侧栏同一实现）",
  },
  {
    specifier: "./FollowedTeamsPicker",
    reason: "关注球队选择器（与侧栏同一组件、同一份状态）",
  },
  { specifier: "./FactList", reason: "只读事实列表原语" },
  {
    specifier: "../semantic/metadata-resolver",
    reason: "球队展示载荷（只借类型）：关注球队一节的输入，不是事件数据",
  },
];

/** 只借类型、不产生运行时依赖的模块。 */
const TYPE_ONLY_IMPORTS = [
  "../theme/theme",
  "../notifications/notification-bridge",
  "../semantic/metadata-resolver",
];

const IMPORT_SPECIFIER = /from\s+"([^"]+)"/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 只借类型：`import type { … } from "…"`，或具名列表里每一项都带 `type`
 * （仓库里两种写法都在用）。整包 / 默认导入不算——那会带进执行代码。
 */
function isTypeOnlyImport(source: string, specifier: string): boolean {
  const escaped = escapeRegExp(specifier);
  if (new RegExp(`import\\s+type\\s+[^;]*from\\s+"${escaped}"`).test(source)) {
    return true;
  }
  const named = new RegExp(
    `import\\s+\\{([^}]*)\\}\\s+from\\s+"${escaped}"`,
  ).exec(source);
  if (named === null) {
    return false;
  }
  const entries = named[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return (
    entries.length > 0 && entries.every((entry) => entry.startsWith("type "))
  );
}

function settingsPageImportProblems(
  pageSource: string,
  allowed: ReadonlyArray<{ specifier: string; reason: string }>,
  typeOnlyImports: readonly string[] = TYPE_ONLY_IMPORTS,
): string[] {
  const problems: string[] = [];
  const specifiers = [...pageSource.matchAll(IMPORT_SPECIFIER)].map(
    (match) => match[1],
  );
  const allowedNames = new Set(allowed.map((entry) => entry.specifier));
  for (const specifier of specifiers) {
    if (!allowedNames.has(specifier)) {
      problems.push(
        `设置页 import 了白名单外的 ${specifier}：设置页是偏好页，不是数据页（验收：不演变为 Dashboard）`,
      );
    }
  }
  for (const entry of allowed) {
    if (!specifiers.includes(entry.specifier)) {
      problems.push(
        `白名单里的 ${entry.specifier} 已经没人 import：一并把它从白名单里删掉（授权不该烂成一串“曾经允许”）`,
      );
    }
  }
  for (const specifier of typeOnlyImports) {
    if (!isTypeOnlyImport(pageSource, specifier)) {
      problems.push(
        `${specifier} 必须只借类型：设置页不该把语义层 / 主题 / 通知桥的执行代码带进来`,
      );
    }
  }
  return problems;
}

const MODULE_SOURCES = collectModuleSources(SOURCE_DIR);
const SETTING_KEYS = findSettingKeys(MODULE_SOURCES);

/**
 * 非偏好：提醒去重日志（NOTIFY-004）。它是调度状态而不是用户选择——
 * 没有控件、由调度链路自己写，与偏好共用 settings 分区只是为了共用一个存储。
 */
const NON_PREFERENCE_KEYS = ["notifications.firedReminders"];

/** 逐条钉住的偏好清单：新增一条偏好必须显式改这里（同时补齐两端证据）。 */
const PREFERENCE_KEYS = [
  "app.closeBehavior",
  "app.theme",
  "football.followedTeams",
  "notifications.enabled",
  "notifications.matchReminderMinutes",
  "sources.builtinHidden",
  "webcal.refreshIntervalMinutes",
];

describe("偏好注册表（SC-018 验收「所有 v0.1 偏好可持久化」）", () => {
  it("键名形态与唯一性：命名空间.名字，且没有两个常量抢同一个键", () => {
    expect(SETTING_KEYS.length).toBeGreaterThan(0);
    expect(settingKeyShapeProblems(SETTING_KEYS)).toEqual([]);
  });

  it("清单被钉住：偏好 7 条 + 去重日志 1 条", () => {
    expect(
      SETTING_KEYS.map((key) => key.value)
        .filter((value) => !NON_PREFERENCE_KEYS.includes(value))
        .sort(),
    ).toEqual([...PREFERENCE_KEYS].sort());
    expect(
      SETTING_KEYS.map((key) => key.value)
        .filter((value) => NON_PREFERENCE_KEYS.includes(value))
        .sort(),
    ).toEqual([...NON_PREFERENCE_KEYS].sort());
  });

  it("没有读不出键名的声明：注册表不会漏掉一条键", () => {
    expect(unreadableKeyDeclarations(MODULE_SOURCES)).toEqual([]);
  });

  it("每个键都写得进快照、读得回来，且读取经过边界（App.tsx 是唯一读写方）", () => {
    expect(keyContractProblems(APP_SOURCE, SETTING_KEYS)).toEqual([]);
  });

  it("设置键不写死在调用点上：新偏好要登记成 *_SETTING_KEY", () => {
    // App.tsx 里只有两个非注册表实参：persistSetting 的转发形参与
    // LAST_OPENED_SETTING（应用状态）。其余出现字面量键名即为违规。
    expect(literalKeyArgumentProblems(APP_SOURCE)).toEqual([]);
    expect(APP_SOURCE).toContain(
      'const LAST_OPENED_SETTING = "app.lastOpenedAt"',
    );
  });
});

describe("改动即时生效（SC-018 验收「即时生效或明确提示需重启」）", () => {
  it("写偏好的 handler 都同时有落盘与即时效果，且每条偏好都有改动入口", () => {
    expect(
      handlerImmediacyProblems(APP_SOURCE, SETTING_KEYS, {
        nonPreference: NON_PREFERENCE_KEYS,
      }),
    ).toEqual([]);
  });
});

describe("设置页不演变为 Dashboard（SC-018 验收）", () => {
  it("设置页只 import 偏好规则、展示原语与类型（事件数据与派生层进不来）", () => {
    expect(
      settingsPageImportProblems(SETTINGS_PAGE_SOURCE, SETTINGS_PAGE_IMPORTS),
    ).toEqual([]);
  });
});

describe("守卫的牙齿", () => {
  const themeKey: SettingKey = {
    constant: "THEME_SETTING_KEY",
    value: "app.theme",
    file: "theme/theme.ts",
  };

  it("键名形态：缺命名空间、重复声明都会被报出来", () => {
    expect(
      settingKeyShapeProblems([
        {
          constant: "THEME_SETTING_KEY",
          value: "theme",
          file: "theme/theme.ts",
        },
      ]),
    ).toHaveLength(1);
    expect(
      settingKeyShapeProblems([
        themeKey,
        { constant: "OTHER_SETTING_KEY", value: "app.theme", file: "x.ts" },
      ]),
    ).toHaveLength(1);
    // 合法形态是安静的。
    expect(settingKeyShapeProblems([themeKey])).toEqual([]);
  });

  it("持久化：写而不读、读而不写、读取没有边界，各报一条", () => {
    const writeOnly = keyContractProblems(
      'const save = () => store.setSetting(THEME_SETTING_KEY, "dark");',
      [themeKey],
    );
    // 只写不读：报一条（缺启动读取；没读也就谈不上边界，不再叠一条）。
    expect(writeOnly).toHaveLength(1);
    expect(writeOnly.join()).toContain("没有启动读取");

    // 读而不写，且读取没有边界：两件事各报一条。
    const readOnly = keyContractProblems(
      "const load = () => store.getSetting(THEME_SETTING_KEY);",
      [themeKey],
    );
    expect(readOnly.join()).toContain("没有写入路径");
    expect(readOnly.join()).toContain("没经过读 / 归一化边界");

    // 有边界、有读取，但没写入：只剩一条。
    const boundaryOnly = keyContractProblems(
      "const load = () => normalizeTheme(store.getSetting(THEME_SETTING_KEY));",
      [themeKey],
    );
    expect(boundaryOnly).toHaveLength(1);
    expect(boundaryOnly.join()).toContain("没有写入路径");
  });

  it("字面量键名被拦下，登记过的两种写法放行", () => {
    expect(
      literalKeyArgumentProblems('store.getSetting("app.theme")'),
    ).toHaveLength(1);
    // 显式类型参数不能成为绕过口（App.tsx 读“上次启动”就是用这种写法）。
    expect(
      literalKeyArgumentProblems('store.getSetting<string>("app.theme")'),
    ).toHaveLength(1);
    expect(
      literalKeyArgumentProblems("store.getSetting(THEME_SETTING_KEY)"),
    ).toEqual([]);
    expect(literalKeyArgumentProblems("store.setSetting(key, value)")).toEqual(
      [],
    );
    expect(
      literalKeyArgumentProblems("store.getSetting(LAST_OPENED_SETTING)"),
    ).toEqual([]);
  });

  it("读不出键名的声明会被报出来（键不会悄悄离开注册表）", () => {
    expect(
      unreadableKeyDeclarations([
        {
          file: "settings/x.ts",
          source: "export const X_SETTING_KEY: string = KEY_NAMES.x;",
        },
      ]),
    ).toHaveLength(1);
    // 收得宽的声明（类型标注 / as const / 单引号）读得出来，不报。
    expect(
      unreadableKeyDeclarations([
        {
          file: "settings/x.ts",
          source:
            "export const X_SETTING_KEY: string = 'app.x' as const;\nexport const Y_SETTING_KEY = \"app.y\";",
        },
      ]),
    ).toEqual([]);
    expect(
      findSettingKeys([
        {
          file: "settings/x.ts",
          source:
            "export const X_SETTING_KEY: string = 'app.x' as const;\nexport const Y_SETTING_KEY = \"app.y\";",
        },
      ]).map((key) => key.value),
    ).toEqual(["app.x", "app.y"]);
  });

  it("只落盘、没有即时效果的 handler 被报出来；补上即时效果后放行", () => {
    const persistOnly = handlerImmediacyProblems(
      "async function handleChangeTheme(next) {\n  await persistSetting(THEME_SETTING_KEY, next);\n}",
      [themeKey],
    );
    expect(persistOnly).toHaveLength(1);
    expect(persistOnly.join()).toContain("handleChangeTheme");

    expect(
      handlerImmediacyProblems(
        "async function handleChangeTheme(next) {\n  setTheme(next);\n  await persistSetting(THEME_SETTING_KEY, next);\n}",
        [themeKey],
      ),
    ).toEqual([]);

    // setTimeout 不算“界面已经变了”。
    expect(
      handlerImmediacyProblems(
        "async function handleChangeTheme(next) {\n  setTimeout(() => {}, 0);\n  await persistSetting(THEME_SETTING_KEY, next);\n}",
        [themeKey],
      ),
    ).toHaveLength(1);

    // 没有改动入口的偏好也是问题。
    expect(
      handlerImmediacyProblems("function handleNothing() { return 1; }", [
        themeKey,
      ]),
    ).toHaveLength(1);
  });

  it("设置页 import 白名单外的模块被拦下，白名单里的死项也被报出来", () => {
    const allowed = [{ specifier: "./FactList", reason: "原语" }];
    const violation = settingsPageImportProblems(
      'import { buildMonthBuckets } from "../calendar/event-buckets";\nimport { FactList } from "./FactList";',
      allowed,
      [],
    );
    expect(violation).toHaveLength(1);
    expect(violation.join()).toContain("event-buckets");

    // 白名单里的项没人 import：报死项（授权要跟着代码一起收）。
    expect(settingsPageImportProblems("", allowed, [])).toHaveLength(1);

    // 只借类型的模块必须是类型导入：两种写法都算（`import type {…}` 与
    // 具名列表里每项带 `type`），带进执行代码的普通导入不算。
    const themeImport = [{ specifier: "../theme/theme", reason: "主题取值" }];
    expect(
      settingsPageImportProblems(
        'import { Theme } from "../theme/theme";',
        themeImport,
        ["../theme/theme"],
      ).join(),
    ).toContain("必须只借类型");
    expect(
      settingsPageImportProblems(
        'import { type Theme } from "../theme/theme";',
        themeImport,
        ["../theme/theme"],
      ),
    ).toEqual([]);
    expect(
      settingsPageImportProblems(
        'import type { Theme } from "../theme/theme";',
        themeImport,
        ["../theme/theme"],
      ),
    ).toEqual([]);
  });

  it("改动入口换写法（useCallback / 箭头函数）也认得出", () => {
    const handlers = handlerBodies(
      [
        "const handleChangeTheme = useCallback(async (next: Theme) => {",
        "  setTheme(next);",
        "  await persistSetting(THEME_SETTING_KEY, next);",
        "}, []);",
        "const handleToggle = (next: Theme) => {",
        "  setTheme(next);",
        "};",
      ].join("\n"),
    );
    expect(handlers.map((handler) => handler.name)).toEqual([
      "handleChangeTheme",
      "handleToggle",
    ]);

    // 换了写法、少了即时效果，照样报得出来。
    expect(
      handlerImmediacyProblems(
        "const handleChangeTheme = useCallback(async (next) => {\n  await persistSetting(THEME_SETTING_KEY, next);\n}, []);",
        [themeKey],
      ),
    ).toHaveLength(1);
  });
});
