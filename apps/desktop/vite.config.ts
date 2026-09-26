/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 版本号只有一个来源（SC-022）：package.json 的 version 经 define 注入
// `__APP_VERSION__`，设置页「关于」显示的就是它。Cargo.toml 与
// tauri.conf.json 的版本由 packaging.test.ts 要求与这里一致。
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { port: 1420, strictPort: true },
  test: {
    environment: "jsdom",
    // 基线（SC-020）：只收 *.bench.ts，运行环境按文件头注释取 node
    // ——纯计算与磁盘 I/O 不该被 jsdom 的开销污染。
    benchmark: { include: ["src/**/*.bench.ts"] },
  },
});
