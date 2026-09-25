// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APP_LICENSE,
  APP_NAME_EN,
  APP_NAME_ZH,
  APP_VERSION,
} from "./settings/app-info";

/**
 * 打包与发布守卫（SC-022 验收：应用名称统一、正式图标、License、第三方资产）。
 *
 * 这些约定跨语言、跨文件（TS / Rust / JSON / Markdown），评审时最容易漏：
 * 改了 tauri.conf.json 的版本忘了改 Cargo.toml、换名字换了两个地方里的一个、
 * 手滑提交一张来源不明的图片。这里把它们变成可执行的断言，让发布门槛里
 * 「版本信息一致」「名称统一」「资产有记录」几项不靠人记得。
 *
 * 只读源码与配置文件，不跑 tauri build（打包是发布动作，见 docs/release.md）。
 */

const DESKTOP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const REPO_ROOT = path.resolve(DESKTOP_ROOT, "../..");
const TAURI_ROOT = path.join(DESKTOP_ROOT, "src-tauri");

function readJson(absolutePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(absolutePath, "utf8")) as Record<
    string,
    unknown
  >;
}

const tauriConfig = readJson(path.join(TAURI_ROOT, "tauri.conf.json"));
const bundle = tauriConfig.bundle as Record<string, unknown>;
const windowsBundle = bundle.windows as Record<string, unknown>;
const nsis = windowsBundle.nsis as Record<string, unknown>;

/** 仓库内的二进制资产只有这几处，且每一处都要在 docs/third-party-assets.md 里有记录。 */
const ALLOWED_ASSET_PREFIXES = [
  "apps/desktop/src-tauri/app-icon.png",
  "apps/desktop/src-tauri/app-icon.svg",
  "apps/desktop/src-tauri/icons/", // `npm run icon` 的产物
  "docs/examples/ui/", // 人工验收截图与设计参考图
];

/**
 * `tauri icon` 会产出的文件名是固定的（各平台尺寸 + ico / icns）。
 * 把它写成闭集，`icons/` 目录里就不会悄悄多出一张从别处拷来的图。
 */
const GENERATED_ICON_NAMES = [
  "32x32.png",
  "64x64.png",
  "128x128.png",
  "128x128@2x.png",
  "Square30x30Logo.png",
  "Square44x44Logo.png",
  "Square71x71Logo.png",
  "Square89x89Logo.png",
  "Square107x107Logo.png",
  "Square142x142Logo.png",
  "Square150x150Logo.png",
  "Square284x284Logo.png",
  "Square310x310Logo.png",
  "StoreLogo.png",
  "icon.png",
  "icon.ico",
  "icon.icns",
];

/**
 * 示例图目录按「目录 / 文件」逐个登记：新增一个目录（例如换一次验收记录）
 * 会先被要求登记，而不是靠 `docs/examples/ui/` 这个前缀蒙过去。
 */
const ASSET_LEDGER_DIR = "docs/examples/ui";

const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".icns",
  ".svg",
  ".avif",
];

/** 字体 / 音视频 / 压缩包：v0.1 一个都不需要，出现即视为未记录的资产。 */
const MEDIA_EXTENSIONS = [
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".mp3",
  ".mp4",
  ".webm",
  ".wav",
  ".m4a",
  ".mov",
  ".pdf",
  ".zip",
];

const SKIP_DIRS = new Set(["node_modules", "target", "dist", ".git", ".vite"]);

function collectRepoFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
        continue;
      }
      files.push(
        path
          .relative(REPO_ROOT, path.join(dir, entry.name))
          .split(path.sep)
          .join("/"),
      );
    }
  };
  walk(REPO_ROOT);
  return files;
}

function pngSize(absolutePath: string): { width: number; height: number } {
  const buffer = readFileSync(absolutePath);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** 某个目录下的全部 .ts / .tsx 源码（绝对路径）。 */
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

/** ICO 目录里登记的边长（0 表示 256，与格式约定一致）。 */
function icoSizes(absolutePath: string): number[] {
  const buffer = readFileSync(absolutePath);
  const count = buffer.readUInt16LE(4);
  const sizes: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const width = buffer[6 + index * 16];
    sizes.push(width === 0 ? 256 : width);
  }
  return sizes;
}

describe("打包配置（SC-022 / app-spec §18、§20）", () => {
  it("版本号在四处一致，界面显示的版本就是安装包的版本", () => {
    const rootPackage = readJson(path.join(REPO_ROOT, "package.json"));
    const desktopPackage = readJson(path.join(DESKTOP_ROOT, "package.json"));
    const cargo = readFileSync(path.join(TAURI_ROOT, "Cargo.toml"), "utf8");
    const cargoVersion = /^version = "([^"]+)"/m.exec(cargo)?.[1];

    // 打包真正读的两个来源（Cargo 与 tauri.conf.json）必须一致；
    // root package.json 是仓库门面，桌面端 package.json 是版本号的唯一来源。
    expect(
      new Set([
        desktopPackage.version,
        rootPackage.version,
        tauriConfig.version,
        cargoVersion,
      ]).size,
    ).toBe(1);
    // APP_VERSION 由构建期从桌面端 package.json 注入，界面显示的就是它。
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(APP_VERSION).toBe(desktopPackage.version);
  });

  it("名称按策略统一：界面用中文名、系统集成用英文名、可执行文件保持 ASCII", () => {
    expect(tauriConfig.productName).toBe(APP_NAME_EN);
    expect(tauriConfig.identifier).toBe("com.semanticcalendar.desktop");

    // 界面内：窗口标题、侧栏品牌、托盘提示、浏览器预览标题
    const windowConfig = (tauriConfig.app as { windows: { title: string }[] })
      .windows[0];
    expect(windowConfig.title).toBe(APP_NAME_ZH);
    expect(
      readFileSync(path.join(DESKTOP_ROOT, "index.html"), "utf8"),
    ).toContain(`<title>${APP_NAME_ZH}</title>`);
    expect(
      readFileSync(path.join(TAURI_ROOT, "src/shell.rs"), "utf8"),
    ).toContain(`.tooltip("${APP_NAME_ZH}")`);

    // 可执行文件名来自 Cargo 包名，策略里说好保持 ASCII（不带空格）
    const cargo = readFileSync(path.join(TAURI_ROOT, "Cargo.toml"), "utf8");
    expect(/^name = "([^"]+)"/m.exec(cargo)?.[1]).toBe("semantic-calendar");
  });

  it("中文名只有 settings/app-info.ts 一处字面量，其余前端代码都引用它", () => {
    // 名称统一不是把同一句话抄到各处：除 app-info.ts 与测试外，前端源码里
    // 不应该再出现中文名的字面量（窗口标题、index.html 与托盘在别的语言里，
    // 由本文的其它用例分别守住）。
    const sources = collectSources(path.join(DESKTOP_ROOT, "src")).filter(
      (file) => !/\.test\.tsx?$/.test(file),
    );
    const hardcoded = sources
      .filter((file) => path.basename(file) !== "app-info.ts")
      .filter((file) => readFileSync(file, "utf8").includes(APP_NAME_ZH))
      .map((file) =>
        path.relative(DESKTOP_ROOT, file).split(path.sep).join("/"),
      );

    expect(hardcoded).toEqual([]);
    // 守卫本身有效：它确实能看见那个唯一的来源文件。
    expect(
      readFileSync(path.join(DESKTOP_ROOT, "src/settings/app-info.ts"), "utf8"),
    ).toContain(APP_NAME_ZH);
  });

  it("安装包元数据完整：产品名、发布者、版权、描述、分类", () => {
    expect(bundle.publisher).toBe("Semantic Calendar contributors");
    expect(bundle.copyright).toContain("Semantic Calendar contributors");
    expect(bundle.shortDescription).toBe("可识别事件语义的桌面日历");
    expect(String(bundle.longDescription).split("\n\n")).toHaveLength(2);
    expect([
      "Business",
      "DeveloperTool",
      "Education",
      "Entertainment",
      "Finance",
      "GraphicsAndDesign",
      "HealthcareAndFitness",
      "Lifestyle",
      "Medical",
      "Music",
      "News",
      "Photography",
      "Productivity",
      "Reference",
      "SocialNetworking",
      "Sports",
      "Travel",
      "Utility",
      "Video",
      "Weather",
    ]).toContain(bundle.category);
  });

  it("License 已确定：标识、文件、正文与版权行对得上", () => {
    expect(bundle.license).toBe(APP_LICENSE);

    // licenseFile 相对 tauri.conf.json 解析，指向仓库根目录的 LICENSE
    const licenseFile = path.resolve(TAURI_ROOT, String(bundle.licenseFile));
    expect(licenseFile).toBe(path.join(REPO_ROOT, "LICENSE"));
    expect(existsSync(licenseFile)).toBe(true);

    const licenseText = readFileSync(licenseFile, "utf8");
    expect(licenseText).toContain("MIT License");
    // 版权行在 LICENSE 与安装包元数据里必须是同一句
    expect(licenseText).toMatch(/^Copyright \(c\) .+$/m);
    expect(licenseText.match(/^Copyright \(c\) .+$/m)?.[0]).toBe(
      bundle.copyright,
    );
    expect(licenseText).toContain("docs/third-party-assets.md");
  });

  it("正式图标：源图是 1024 方图，bundle 引用的每个文件都在且尺寸符合约定", () => {
    const source = path.join(TAURI_ROOT, "app-icon.png");
    expect(pngSize(source)).toEqual({ width: 1024, height: 1024 });
    expect(
      readFileSync(path.join(TAURI_ROOT, "app-icon.svg"), "utf8"),
    ).toContain('viewBox="0 0 1024 1024"');

    const icons = bundle.icon as string[];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(existsSync(path.join(TAURI_ROOT, icon))).toBe(true);
    }

    // Windows 侧真正被用到的两种形态：应用图标（.ico）与高位图
    const icoSizesFound = icoSizes(path.join(TAURI_ROOT, "icons/icon.ico"));
    expect(icoSizesFound).toEqual(expect.arrayContaining([16, 32, 48, 256]));
    expect(pngSize(path.join(TAURI_ROOT, "icons/128x128@2x.png"))).toEqual({
      width: 256,
      height: 256,
    });
    expect(pngSize(path.join(TAURI_ROOT, "icons/32x32.png"))).toEqual({
      width: 32,
      height: 32,
    });
  });

  it("升级策略已定：v0.1 不做自动更新，安装器只出 NSIS、当前用户、不允许降级", () => {
    expect(bundle.createUpdaterArtifacts).toBe(false);
    expect(bundle.targets).toEqual(["nsis"]);
    expect(windowsBundle.allowDowngrades).toBe(false);
    expect(nsis.installMode).toBe("currentUser");
    expect(nsis.languages).toEqual(["SimpChinese", "English"]);
    expect(nsis.displayLanguageSelector).toBe(true);
  });

  it("仓库里的图片资产都在允许清单内", () => {
    const assets = collectRepoFiles().filter((file) =>
      IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase()),
    );
    expect(assets.length).toBeGreaterThan(0);
    expect(
      assets.filter(
        (file) =>
          !ALLOWED_ASSET_PREFIXES.some((allowed) => file.startsWith(allowed)),
      ),
    ).toEqual([]);
  });

  it("icons/ 目录里只有 `tauri icon` 会产出的那些文件", () => {
    const generated = readdirSync(path.join(TAURI_ROOT, "icons")).sort();
    expect(generated).toEqual([...GENERATED_ICON_NAMES].sort());
  });

  it("仓库里没有字体、音视频或压缩包资产", () => {
    expect(
      collectRepoFiles().filter((file) =>
        MEDIA_EXTENSIONS.includes(path.extname(file).toLowerCase()),
      ),
    ).toEqual([]);
  });

  it("每一个资产位置都在 docs/third-party-assets.md 里有来源与许可记录", () => {
    const ledger = readFileSync(
      path.join(REPO_ROOT, "docs/third-party-assets.md"),
      "utf8",
    );
    for (const allowed of ALLOWED_ASSET_PREFIXES) {
      expect(ledger).toContain(allowed);
    }

    // 示例图目录按条目逐个登记：换一次验收记录就会多一个目录，
    // 那个目录必须先出现在清单里，否则前缀匹配就成了万能通行证。
    const exampleEntries = readdirSync(path.join(REPO_ROOT, ASSET_LEDGER_DIR), {
      withFileTypes: true,
    });
    expect(exampleEntries.length).toBeGreaterThan(0);
    for (const entry of exampleEntries) {
      const name = entry.isDirectory() ? `${entry.name}/` : entry.name;
      expect(ledger).toContain(name);
    }
  });

  it("跳过的目录都是构建产物，不是把资产藏起来躲开清单", () => {
    const gitignore = readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
    for (const skip of SKIP_DIRS) {
      // .git 由 git 自己排除，其余跳过项都必须在 .gitignore 里
      if (skip !== ".git") expect(gitignore).toContain(skip);
    }
  });
});
