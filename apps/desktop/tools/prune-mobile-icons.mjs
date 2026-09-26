// 移除 Tauri CLI 顺带产出的移动端图标集（由 `npm run icon` 在 tauri icon 之后调用）。
//
// 本仓库只做 Windows 桌面端（SC-022）：android/ 与 ios/ 的图标桌面应用用不到，
// 留着只会让 `packaging.test.ts` 的「仓库里的图片资产都在清单里」多出一堆
// 没人登记、也没人使用的目录。要支持移动端时删掉这一步，并把这两套图标
// 登记进 docs/third-party-assets.md。
//
// 用法：node tools/prune-mobile-icons.mjs
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const iconsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src-tauri",
  "icons",
);

for (const name of ["android", "ios"]) {
  rmSync(path.join(iconsDir, name), { recursive: true, force: true });
}
