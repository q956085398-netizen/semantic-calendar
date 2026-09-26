/**
 * WebCal / ICS 订阅地址处理（SC-007 / SRC-002 / app-spec §14）。
 *
 * 三件事：
 * - 归一化与校验：webcal:// 按 https:// 处理，缺协议时补 https://；
 * - 稳定 sourceId：同一地址重复添加命中同一来源，且 id 不携带 token；
 * - 脱敏：日志、错误文案与 UI 只使用脱敏形式（host + path，查询串省略）。
 */

import { redactUrl } from "../../reliability/redact";

export type WebcalUrlError = "empty" | "unsupported-scheme" | "invalid";

export type WebcalUrlResult =
  { ok: true; url: string } | { ok: false; error: WebcalUrlError };

export const WEBCAL_URL_ERROR_MESSAGES: Record<WebcalUrlError, string> = {
  empty: "请输入订阅地址",
  "unsupported-scheme": "只支持 http / https / webcal 地址",
  invalid: "地址格式无法解析",
};

/**
 * 协议前缀判定：要求 “://”。
 * 只按 “:” 判定会把 `example.com:8080/feed.ics` 这类 host:port 输入
 * 误当成协议，导致本该补 https:// 的地址被拒绝。
 */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * 归一化订阅地址：去空白、补协议、webcal → https、去 fragment。
 * 查询串（可能含 token）原样保留，仅用于本地抓取。
 *
 * webcal → https 在解析前替换协议前缀：URL 规范禁止把非特殊协议
 * （webcal）直接改写成特殊协议（https），改写 protocol 字段是空操作。
 * 交给解析器处理还能顺带拿到主机名小写等特殊协议的规范化行为。
 */
export function normalizeWebcalUrl(input: string): WebcalUrlResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, error: "empty" };
  }

  // 用户常直接粘贴 “example.com/cal.ics”，缺协议时按 https 处理。
  const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
  const scheme = schemeOf(candidate);

  if (scheme === "webcal" || scheme === "webcals") {
    return parseCandidate(candidate.replace(HAS_SCHEME, "https://"));
  }
  if (scheme !== "http" && scheme !== "https") {
    return { ok: false, error: "unsupported-scheme" };
  }
  return parseCandidate(candidate);
}

function schemeOf(value: string): string {
  const match = HAS_SCHEME.exec(value);
  return match === null ? "" : match[0].replace(/:\/\/$/, "").toLowerCase();
}

function parseCandidate(candidate: string): WebcalUrlResult {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    // http / https 下主机名为空本身就是解析失败，因此没有单独的“缺主机名”分支。
    return { ok: false, error: "invalid" };
  }

  // fragment 对订阅没有意义，去掉可避免同一地址产生两个 sourceId。
  parsed.hash = "";
  return { ok: true, url: parsed.toString() };
}

/**
 * 稳定 sourceId：地址的 64 位散列，不写入 token 本身。
 * 同一地址（含 webcal:// 与 https:// 两种写法）得到同一来源。
 */
export function sourceIdForWebcalUrl(url: string): string {
  return `webcal:${hash64(url)}`;
}

/** 侧栏展示名：host + path，不含查询串（token 不进 UI）。 */
export function webcalDisplayName(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return "订阅日历";
  }
}

/**
 * 脱敏地址：保留协议 / 主机 / 路径，查询串与账号信息一律省略。
 * 无法解析时返回不带任何原文的占位串。
 *
 * 规则本体在 `reliability/redact.ts`（SC-019）：日志、语义错误报告与本模块
 * 共用同一实现，因此“不对劲的地址长什么样”只有一处定义。
 */
export function redactWebcalUrl(url: string): string {
  return redactUrl(url, "订阅地址");
}

/**
 * 从任意文案中抹掉订阅地址细节（app-spec §14：不泄露 URL token）。
 * 网络栈的原始错误常带完整地址，落库与展示前都必须经过这里。
 */
export function redactSensitiveText(message: string, url: string): string {
  if (url === "") {
    // 没有已知地址可脱敏（例如来源已删除）；空串还会让 split 逐字符炸开。
    return message;
  }
  let result = message.split(url).join(redactWebcalUrl(url));

  const queryStart = url.indexOf("?");
  if (queryStart !== -1) {
    const query = url.slice(queryStart);
    if (query.length > 1) {
      result = result.split(query).join("?…");
      // 有些实现只回传参数串本身，不带 “?”。
      result = result.split(query.slice(1)).join("…");
    }
  }
  return result;
}

/**
 * 异常 → 可展示文案：取消息正文并脱敏，空消息回落到通用说明。
 * 服务层与 UI 共用同一实现，避免“某条路径忘了脱敏”。
 */
export function describeRedactedError(error: unknown, url: string): string {
  const raw = (error instanceof Error ? error.message : String(error)).trim();
  return redactSensitiveText(raw === "" ? "未知错误" : raw, url);
}

/**
 * 64 位散列（两个不同初值的 FNV-1a 32 位结果拼接）。
 * 用途只是稳定标识，不承担密码学职责。
 */
function hash64(value: string): string {
  const a = fnv1a32(value, 0x811c9dc5);
  const b = fnv1a32(value, 0x01000193);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

function fnv1a32(value: string, offsetBasis: number): number {
  let hash = offsetBasis;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    hash ^= code;
    // FNV 质数 16777619，用移位相加避免 32 位乘法溢出精度。
    hash =
      (hash +
        ((hash << 1) +
          (hash << 4) +
          (hash << 7) +
          (hash << 8) +
          (hash << 24))) >>>
      0;
  }
  return hash >>> 0;
}
