// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 后台唤醒守卫（SC-020 验收 / app-spec §12「避免高频轮询」）。
 *
 * 「不用 setInterval」这条约束靠代码评审容易漏：加一行 setInterval 就能让
 * 常驻应用永远持有唤醒源，而功能测试全都照常通过。这里把它变成可执行断言：
 *
 * - 前端：`src/` 下除测试外不允许出现 setInterval；后台唤醒只能是
 *   setTimeout（单次、到期后重算，见 refresh-scheduler / notification-scheduler）；
 * - 桌面壳：Rust 侧不允许出现定时器 / 睡眠循环，隐藏窗口后不得新增唤醒源。
 *
 * 调度器本身的行为（空闲零唤醒、只持一个定时器）由它们各自的单测覆盖，
 * 这条守卫只负责挡住“以后有人加回来”。
 */

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
/** 桌面壳与前端同在 apps/desktop 下，因此从 src 的上一级进 src-tauri。 */
const RUST_ROOT = path.join(SRC_ROOT, "..", "src-tauri", "src");

/** 前台允许的定时器原语：一次性 setTimeout（含 clearTimeout）。 */
const FORBIDDEN_TS = [/\bsetinterval\s*\(/];
/** Rust 侧的等价物：周期定时器与睡眠循环。 */
const FORBIDDEN_RUST = [
  /set_interval\s*\(/,
  /time::interval\s*\(/,
  /thread::sleep\s*\(/,
];

function collectSources(dir: string, pattern: RegExp): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSources(absolute, pattern));
    } else if (pattern.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files;
}

const tsSources = collectSources(SRC_ROOT, /\.tsx?$/).filter(
  (file) => !/\.test\.tsx?$/.test(file),
);
const rustSources = collectSources(RUST_ROOT, /\.rs$/);

describe("后台唤醒只允许一次性定时器（app-spec §12）", () => {
  it("扫描范围覆盖两个后台调度器与桌面壳（防止守卫本身失效）", () => {
    const scanned = tsSources.map((file) =>
      path.relative(SRC_ROOT, file).split(path.sep).join("/"),
    );
    expect(scanned).toEqual(
      expect.arrayContaining([
        "data/webcal/refresh-scheduler.ts",
        "notifications/notification-scheduler.ts",
      ]),
    );
    expect(rustSources.length).toBeGreaterThan(0);
  });

  it("前端源码不出现 setInterval", () => {
    expect(findMatches(tsSources, FORBIDDEN_TS)).toEqual([]);
  });

  it("Rust 源码不出现周期定时器或睡眠循环", () => {
    expect(findMatches(rustSources, FORBIDDEN_RUST)).toEqual([]);
  });
});

function findMatches(files: readonly string[], patterns: RegExp[]): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    const contents = readFileSync(file, "utf8").toLowerCase();
    for (const pattern of patterns) {
      if (pattern.test(contents)) {
        offenders.push(`${path.basename(file)} 命中 ${String(pattern)}`);
      }
    }
  }
  return offenders;
}
