// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "src", "index.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

describe("页面切换时的布局稳定性", () => {
  it("切换设置会立即替换页面，三栏骨架不能继续插值改变宽度", () => {
    const shell = /\.app-shell\s*\{([^}]+)\}/.exec(css)?.[1];
    expect(shell).toBeDefined();
    const transitions = [
      ...shell!.matchAll(/transition(?:-property)?:\s*([^;]+)/g),
    ].map((match) => match[1]);
    for (const transition of transitions) {
      expect(transition).not.toMatch(/\b(all|grid-template-columns|width)\b/);
    }
  });
});
