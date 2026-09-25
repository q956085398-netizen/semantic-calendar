// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { yieldToMain } from "./yield-to-main";

/**
 * 分片让出（SC-020）：验证「不同步完成」「一次唤醒全部等待者」
 * 与没有 MessageChannel 时的退路。
 */
describe("让出主线程", () => {
  it("不同步完成：让出后当前任务里仍是未决状态", async () => {
    let resolved = false;
    const pending = yieldToMain().then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);
    await pending;
    expect(resolved).toBe(true);
  });

  it("同一轮的多个等待者由一次唤醒全部完成", async () => {
    const order: number[] = [];
    await Promise.all([
      yieldToMain().then(() => order.push(1)),
      yieldToMain().then(() => order.push(2)),
    ]);
    expect(order).toEqual([1, 2]);
  });

  it("连续让出互不影响：上一轮的唤醒不会顶替下一轮", async () => {
    await yieldToMain();
    let second = false;
    await yieldToMain().then(() => {
      second = true;
    });
    expect(second).toBe(true);
  });

  it("没有 MessageChannel 时退回 setTimeout(0)", async () => {
    vi.resetModules();
    vi.stubGlobal("MessageChannel", undefined);
    try {
      const { yieldToMain: fallbackYield } = await import("./yield-to-main");
      let resolved = false;
      const pending = fallbackYield().then(() => {
        resolved = true;
      });
      expect(resolved).toBe(false);
      await pending;
      expect(resolved).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
