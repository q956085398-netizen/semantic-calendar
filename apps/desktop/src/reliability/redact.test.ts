import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGE_LENGTH,
  REDACTED_EVENT_TEXT,
  describeEventError,
  describeSafeError,
  errorNameOf,
  redactCredentials,
  redactEventText,
  redactUrl,
  redactUrls,
  sanitizeMessage,
} from "./redact";

const SECRET_URL = "https://calendar.example.com/feed.ics?token=SECRET-TOKEN";

describe("redactUrl（SC-019 / §14）", () => {
  it("保留协议 / 主机 / 路径，省略查询串", () => {
    expect(redactUrl(SECRET_URL)).toBe(
      "https://calendar.example.com/feed.ics?…",
    );
    expect(redactUrl("https://example.com/a.ics")).toBe(
      "https://example.com/a.ics",
    );
    // 没有路径时不留多余的斜杠差异，也不多出问号。
    expect(redactUrl("https://example.com")).toBe("https://example.com/");
  });

  it("账号信息不进结果（user:pass@ 不是 host 的一部分）", () => {
    expect(redactUrl("https://user:pass@example.com/a.ics?t=1")).toBe(
      "https://example.com/a.ics?…",
    );
  });

  it("协议按原文保留：webcal 不会被改写成 https", () => {
    expect(redactUrl("webcal://example.com/feed.ics?token=SECRET")).toBe(
      "webcal://example.com/feed.ics?…",
    );
  });

  it("解析不了的整段换成 fallback", () => {
    expect(redactUrl("not a url", "订阅地址")).toBe("订阅地址");
    expect(redactUrl("https://user:pass@/a.ics", "订阅地址")).toBe("订阅地址");
  });
});

describe("redactUrls：从文案里挑出地址", () => {
  it("句子其余部分原样保留，句末标点不属于地址", () => {
    expect(redactUrls(`error sending request for url (${SECRET_URL})`)).toBe(
      "error sending request for url (https://calendar.example.com/feed.ics?…)",
    );
    expect(redactUrls(`抓取失败：${SECRET_URL}。`)).toBe(
      "抓取失败：https://calendar.example.com/feed.ics?…。",
    );
  });

  it("一条文案里的多个地址都被处理，没有地址时原样返回", () => {
    const message = `A(${SECRET_URL}) → B(https://other.example.com/b.ics?k=2)`;
    const redacted = redactUrls(message);

    expect(redacted).not.toContain("SECRET-TOKEN");
    expect(redacted).not.toContain("k=2");
    expect(redacted).toContain("https://other.example.com/b.ics?…");
    expect(redactUrls("没有地址的普通说明")).toBe("没有地址的普通说明");
  });
});

describe("redactCredentials：没被识别成 URL 的凭据", () => {
  it("常见凭据参数只留参数名", () => {
    expect(redactCredentials("服务端拒绝 token=SECRET-TOKEN")).toBe(
      "服务端拒绝 token=…",
    );
    expect(redactCredentials("a.ics?x=1&access_token=abc&y=2")).toBe(
      "a.ics?x=1&access_token=…&y=2",
    );
    expect(redactCredentials("signature=abc;password=pw")).toBe(
      "signature=…;password=…",
    );
  });

  it("普通正文不误伤（参数名是一份保守白名单）", () => {
    expect(redactCredentials("status=200，耗时 code=42")).toBe(
      "status=200，耗时 code=42",
    );
    expect(redactCredentials("提货 token")).toBe("提货 token");
  });
});

describe("redactEventText：事件正文不进日志", () => {
  const event = {
    title: "和医生的预约",
    description: "带上检查报告",
    location: "市立医院 3 楼",
  };

  it("标题 / 描述 / 地点都换成占位符，说明部分仍可读", () => {
    const redacted = redactEventText(
      "解析「和医生的预约」失败：地点 市立医院 3 楼 不在时区表里（带上检查报告）",
      event,
    );

    expect(redacted).not.toContain("和医生的预约");
    expect(redacted).not.toContain("市立医院");
    expect(redacted).not.toContain("带上检查报告");
    expect(redacted).toContain(REDACTED_EVENT_TEXT);
    expect(redacted).toContain("不在时区表里");
  });

  it("过短的值不参与替换（单字符当子串会毁掉整条文案）", () => {
    expect(redactEventText("值 - 无效", { title: "-" })).toBe("值 - 无效");
  });

  it("normalizedTitle 也是正文（标准化标题可能被重写过）", () => {
    expect(
      redactEventText("标题「晚间例会」无法解析", {
        title: "晚间例会 19:00",
        normalizedTitle: "晚间例会",
      }),
    ).toBe(`标题「${REDACTED_EVENT_TEXT}」无法解析`);
  });

  it("标题里的换行在文案中被折成空格时仍然匹配", () => {
    const redacted = redactEventText("解析 两行\n标题 失败", {
      title: "两行\n标题",
    });

    expect(redacted).toBe(`解析 ${REDACTED_EVENT_TEXT} 失败`);
  });
});

describe("describeSafeError / describeEventError", () => {
  it("折叠空白、脱敏地址与裸凭据、限制长度", () => {
    expect(describeSafeError(new Error(`失败：\n  ${SECRET_URL}`))).toBe(
      "失败： https://calendar.example.com/feed.ics?…",
    );
    expect(describeSafeError(new Error("服务端拒绝 token=SECRET-TOKEN"))).toBe(
      "服务端拒绝 token=…",
    );
    // 空消息回落到通用说明，而不是留下一对空括号。
    expect(describeSafeError(new Error("   "))).toBe("未知错误");
    expect(describeSafeError(undefined)).toBe("undefined");

    const long = describeSafeError(new Error("x".repeat(500)));
    expect(long).toHaveLength(MAX_MESSAGE_LENGTH);
    expect(long.endsWith("…")).toBe(true);
  });

  it("异常类型名单独给出，而不是混进文案", () => {
    expect(errorNameOf(new TypeError("boom"))).toBe("TypeError");
    expect(errorNameOf(new Error("boom"))).toBe("Error");
    expect(errorNameOf("字符串错误")).toBe("未知异常");
  });

  it("事件相关失败的报告：类型名 + 已脱敏文案，可以直接打印", () => {
    const report = describeEventError(
      new TypeError(`无法解析「和医生的预约」：${SECRET_URL}`),
      { title: "和医生的预约" },
    );

    expect(report.errorName).toBe("TypeError");
    expect(report.message).not.toContain("和医生的预约");
    expect(report.message).not.toContain("SECRET-TOKEN");
    expect(report.message).toContain(REDACTED_EVENT_TEXT);
  });

  it("超长标题在截断前就被替换掉，尾巴不会留在文案里（SC-019）", () => {
    const title = `很长的标题${"很长".repeat(200)}结尾标记`;
    const report = describeEventError(new Error(`无法解析：${title}`), {
      title,
    });

    expect(report.message).not.toContain("结尾标记");
    expect(report.message).not.toContain("很长的标题");
    expect(report.message).toBe(`无法解析：${REDACTED_EVENT_TEXT}`);
  });
});

describe("sanitizeMessage：已有消息正文时的清洗入口", () => {
  it("折叠空白、脱敏地址；空输入保持为空而不是造一句占位", () => {
    expect(sanitizeMessage("  两行\n说明  ")).toBe("两行 说明");
    expect(sanitizeMessage(`见 ${SECRET_URL}`)).toBe(
      "见 https://calendar.example.com/feed.ics?…",
    );
    expect(sanitizeMessage("")).toBe("");
    expect(sanitizeMessage()).toBe("");
  });

  it("超过上限的正文被截断并留省略号", () => {
    const long = sanitizeMessage("x".repeat(500));

    expect(long).toHaveLength(MAX_MESSAGE_LENGTH);
    expect(long.endsWith("…")).toBe(true);
  });
});
