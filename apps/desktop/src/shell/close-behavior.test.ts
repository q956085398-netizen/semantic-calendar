import { describe, expect, it } from "vitest";
import {
  CLOSE_BEHAVIOR_OPTIONS,
  CLOSE_BEHAVIOR_SETTING_KEY,
  DEFAULT_CLOSE_BEHAVIOR,
  describeCloseBehavior,
  normalizeCloseBehavior,
} from "./close-behavior";

describe("normalizeCloseBehavior", () => {
  it("合法值原样返回", () => {
    expect(normalizeCloseBehavior("hide-to-tray")).toBe("hide-to-tray");
    expect(normalizeCloseBehavior("quit")).toBe("quit");
  });

  it("缺失或非法值回退默认（隐藏到托盘）", () => {
    for (const value of [undefined, null, "", "QUIT", "exit", 1, {}]) {
      expect(normalizeCloseBehavior(value)).toBe("hide-to-tray");
    }
  });

  it("默认值就是隐藏到托盘（常驻日历的预期行为）", () => {
    expect(DEFAULT_CLOSE_BEHAVIOR).toBe("hide-to-tray");
  });
});

describe("CLOSE_BEHAVIOR_OPTIONS", () => {
  it("两个选项覆盖全部取值且文案非空", () => {
    expect(CLOSE_BEHAVIOR_OPTIONS.map((option) => option.value)).toEqual([
      "hide-to-tray",
      "quit",
    ]);
    for (const option of CLOSE_BEHAVIOR_OPTIONS) {
      expect(option.label).not.toBe("");
      expect(option.hint).not.toBe("");
    }
  });

  it("每个选项的取值都能通过规范化往返（UI 不会渲染出无法保存的值）", () => {
    for (const option of CLOSE_BEHAVIOR_OPTIONS) {
      expect(normalizeCloseBehavior(option.value)).toBe(option.value);
    }
  });
});

describe("describeCloseBehavior", () => {
  it("返回对应选项的解释文案", () => {
    expect(describeCloseBehavior("hide-to-tray")).toContain("系统托盘");
    expect(describeCloseBehavior("quit")).toContain("退出");
  });

  it("文案说“隐藏”而不是“最小化”：最小化按钮仍是系统默认行为", () => {
    const hideOption = CLOSE_BEHAVIOR_OPTIONS[0];
    expect(hideOption.label).toBe("隐藏到托盘");
    expect(hideOption.label).not.toContain("最小化");
  });
});

describe("CLOSE_BEHAVIOR_SETTING_KEY", () => {
  it("使用 app.closeBehavior 设置键（与快照设置命名空间一致）", () => {
    expect(CLOSE_BEHAVIOR_SETTING_KEY).toBe("app.closeBehavior");
  });
});
