/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  test: {
    environment: "jsdom",
    // 基线（SC-020）：只收 *.bench.ts，运行环境按文件头注释取 node
    // ——纯计算与磁盘 I/O 不该被 jsdom 的开销污染。
    benchmark: { include: ["src/**/*.bench.ts"] },
  },
});
