import { describe, expect, it } from "vitest";
import { normalizeEventTitle, titleKey } from "./title";

/**
 * SC-008 / app-spec §7.3：标题规范化是 Matcher 的输入，
 * 只做确定性清洗（Unicode + 空白），不引入任何业务判断。
 */

describe("normalizeEventTitle", () => {
  it("全角拉丁字母与标点按 NFKC 归一为半角", () => {
    // NFKC 兼容分解的固定结果：全角 Ａ→A、ｖｓ→vs、全角空格→普通空格。
    expect(
      normalizeEventTitle(
        "Ａｒｓｅｎａｌ　ｖｓ　Ｍａｎｃｈｅｓｔｅｒ　Ｃｉｔｙ",
      ),
    ).toBe("Arsenal vs Manchester City");
  });

  it("折叠多余空白（含制表符、换行、不间断空格）并去除首尾", () => {
    expect(normalizeEventTitle("  周会\u3000例会\t每周\n总结 ")).toBe(
      "周会 例会 每周 总结",
    );
    expect(normalizeEventTitle("Arsenal\u00A0vs\u00A0City")).toBe(
      "Arsenal vs City",
    );
  });

  it("剔除零宽字符等不可见注入", () => {
    expect(normalizeEventTitle("Ars\u200Benal vs\uFEFF City")).toBe(
      "Arsenal vs City",
    );
  });

  it("普通标题原样通过，中文内容不被改写", () => {
    expect(normalizeEventTitle("中秋节")).toBe("中秋节");
    expect(normalizeEventTitle("Arsenal vs Manchester City")).toBe(
      "Arsenal vs Manchester City",
    );
  });

  it("空标题与纯空白标题规范化为空串", () => {
    expect(normalizeEventTitle("")).toBe("");
    expect(normalizeEventTitle("  \u3000 ")).toBe("");
  });
});

describe("titleKey", () => {
  it("规范化后压小写：写法差异（大小写 / 全角 / 多余空格）归一到同一个键", () => {
    expect(titleKey("MAN CITY")).toBe("man city");
    expect(titleKey("  Ａｒｓｅｎａｌ  ")).toBe("arsenal");
    expect(titleKey("Manchester  City")).toBe("manchester city");
    // 中文不受小写影响，原样保留。
    expect(titleKey("阿森纳")).toBe("阿森纳");
    expect(titleKey("   ")).toBe("");
  });
});
