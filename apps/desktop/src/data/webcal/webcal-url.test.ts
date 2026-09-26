import { describe, expect, it } from "vitest";
import {
  normalizeWebcalUrl,
  redactSensitiveText,
  redactWebcalUrl,
  sourceIdForWebcalUrl,
  webcalDisplayName,
} from "./webcal-url";

const SECRET_URL = "https://calendar.example.com/feed.ics?token=SECRET-TOKEN";

describe("normalizeWebcalUrl（SRC-002）", () => {
  it("保留 http / https 地址并去空白", () => {
    expect(normalizeWebcalUrl("  https://example.com/a.ics  ")).toEqual({
      ok: true,
      url: "https://example.com/a.ics",
    });
    expect(normalizeWebcalUrl("http://example.com/a.ics")).toEqual({
      ok: true,
      url: "http://example.com/a.ics",
    });
  });

  it("webcal:// 与 webcals:// 按 https:// 处理", () => {
    expect(normalizeWebcalUrl("webcal://example.com/a.ics")).toEqual({
      ok: true,
      url: "https://example.com/a.ics",
    });
    expect(normalizeWebcalUrl("WEBCAL://Example.com/a.ics")).toEqual({
      ok: true,
      url: "https://example.com/a.ics",
    });
    expect(normalizeWebcalUrl("webcals://example.com/a.ics")).toEqual({
      ok: true,
      url: "https://example.com/a.ics",
    });
  });

  it("缺少协议的输入补 https://", () => {
    expect(normalizeWebcalUrl("example.com/cal.ics")).toEqual({
      ok: true,
      url: "https://example.com/cal.ics",
    });
    // host:port 不能因为没有 “//” 被误判成协议。
    expect(normalizeWebcalUrl("example.com:8080/cal.ics")).toEqual({
      ok: true,
      url: "https://example.com:8080/cal.ics",
    });
  });

  it("保留查询串（含 token），去掉 fragment", () => {
    expect(normalizeWebcalUrl(`${SECRET_URL}#today`)).toEqual({
      ok: true,
      url: SECRET_URL,
    });
  });

  it("拒绝空输入、非法协议与无法解析的地址", () => {
    expect(normalizeWebcalUrl("   ")).toEqual({ ok: false, error: "empty" });
    expect(normalizeWebcalUrl("ftp://example.com/a.ics")).toEqual({
      ok: false,
      error: "unsupported-scheme",
    });
    expect(normalizeWebcalUrl("file:///C:/cal.ics")).toEqual({
      ok: false,
      error: "unsupported-scheme",
    });
    expect(normalizeWebcalUrl("https://")).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(normalizeWebcalUrl("webcal://")).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(normalizeWebcalUrl("not a url")).toEqual({
      ok: false,
      error: "invalid",
    });
  });
});

describe("sourceIdForWebcalUrl", () => {
  it("同一地址的不同写法得到同一 sourceId", () => {
    const a = normalizeWebcalUrl("webcal://example.com/a.ics");
    const b = normalizeWebcalUrl("https://example.com/a.ics");
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(sourceIdForWebcalUrl(a.url)).toBe(sourceIdForWebcalUrl(b.url));
    }
  });

  it("不同地址得到不同 sourceId，且 id 不携带 token", () => {
    const first = sourceIdForWebcalUrl(SECRET_URL);
    const second = sourceIdForWebcalUrl(
      "https://calendar.example.com/other.ics?token=SECRET-TOKEN",
    );

    expect(first).not.toBe(second);
    expect(first).toMatch(/^webcal:[0-9a-f]{16}$/);
    expect(first).not.toContain("SECRET-TOKEN");
    expect(first).not.toContain("example.com");
  });

  it("散列稳定（跨调用一致）", () => {
    expect(sourceIdForWebcalUrl(SECRET_URL)).toBe(
      sourceIdForWebcalUrl(SECRET_URL),
    );
  });
});

describe("脱敏（app-spec §14）", () => {
  it("redactWebcalUrl 省略查询串与账号信息", () => {
    expect(redactWebcalUrl(SECRET_URL)).toBe(
      "https://calendar.example.com/feed.ics?…",
    );
    expect(redactWebcalUrl("https://example.com/a.ics")).toBe(
      "https://example.com/a.ics",
    );
    expect(redactWebcalUrl("https://user:pass@example.com/a.ics?t=1")).toBe(
      "https://example.com/a.ics?…",
    );
    expect(redactWebcalUrl("not a url")).toBe("订阅地址");
  });

  it("redactSensitiveText 从错误文案里抹掉地址与 token", () => {
    const message = `error sending request for url (${SECRET_URL})`;

    const redacted = redactSensitiveText(message, SECRET_URL);

    expect(redacted).not.toContain("SECRET-TOKEN");
    expect(redacted).toBe(
      "error sending request for url (https://calendar.example.com/feed.ics?…)",
    );
  });

  it("redactSensitiveText 也能抹掉只出现参数串的错误文案", () => {
    const redacted = redactSensitiveText(
      "服务端拒绝 token=SECRET-TOKEN",
      SECRET_URL,
    );

    expect(redacted).not.toContain("SECRET-TOKEN");
    expect(redacted).toContain("…");
  });
});

describe("webcalDisplayName", () => {
  it("用 host + path 作为展示名，不含查询串", () => {
    expect(webcalDisplayName(SECRET_URL)).toBe("calendar.example.com/feed.ics");
    expect(webcalDisplayName("https://example.com/")).toBe("example.com");
  });
});
