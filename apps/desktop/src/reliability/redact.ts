/**
 * 脱敏原语（SC-019 / app-spec §14）。
 *
 * 原则：日志与错误文案只留“发生了什么”与“哪个对象”，不留事件正文与地址凭据。
 * 规则在这一处实现，调用方按场景组合：
 * - 地址：保留协议 / 主机 / 路径，查询串与账号信息一律省略（token 常在这里）；
 * - 裸凭据：`token=…` 这类没被识别成 URL 的明文同样抹掉；
 * - 事件正文：标题 / 描述 / 地点替换为占位符，而不是靠调用方自觉不打印；
 * - 文案：折叠空白、截断长度、跑一遍上面几条。
 *
 * 为什么要有结构性的 `describeEventError`：Matcher / Resolver 的错误报告曾经
 * 带上原始 `error` 对象，日志侧再取 `error.message`——那意味着任何一条
 * 把标题拼进 message 的实现都会把事件正文打进控制台，而“报告不含正文”
 * 的约定只写在注释里。现在报告只携带**已经洗过**的文案，取不到原始错误，
 * 忘记脱敏这件事因此不会发生。
 *
 * 顺序很关键：正文替换必须在折叠空白与截断**之前**做。折过之后标题里的
 * 连续空白已经变成单个空格，原文形态就匹配不上了；截断之后更糟——超过
 * 上限的标题会被切掉尾巴，而前缀仍然留在文案里。
 */

/** 地址被脱敏后的占位符（无法解析成 URL 时整段替换）。 */
export const REDACTED_URL = "〔地址〕";

/** 事件正文被替换后的占位符。 */
export const REDACTED_EVENT_TEXT = "〔事件正文〕";

/** 单条文案的长度上限：日志与状态行都不应该被整份正文撑满。 */
export const MAX_MESSAGE_LENGTH = 300;

/** 异常被洗过之后的形状：类型名 + 可直接打印的文案。 */
export interface SanitizedError {
  errorName: string;
  message: string;
}

/** 事件里属于“正文”的字段；缺省字段不参与替换。 */
export interface EventTextField {
  title: string;
  normalizedTitle?: string;
  description?: string;
  location?: string;
}

/**
 * 短于两个字符的值不参与替换：单个字符（如 “-” 或 “1”）当子串处理会把
 * 整条文案改得面目全非，而它本身也不构成“完整私密事件正文”。
 */
const MIN_REDACTABLE_LENGTH = 2;

/** 消息为空时的通用说明：调用方不必各自准备一句兜底文案。 */
const FALLBACK_MESSAGE = "未知错误";

/**
 * 文案里的地址：http / https / webcal，直到空白或明显的收尾标点为止。
 * 标点单独匹配是因为句子里常见的 `…（https://host/feed.ics?token=x）`。
 */
const URL_PATTERN = /(?:https?|webcal):\/\/[^\s"'<>`]+/gi;
/** 地址末尾常带的句读，属于句子而不属于地址。 */
const TRAILING_PUNCTUATION = /[),.;:，。；：、）】」》]+$/u;

/** 协议名（不含 `://`）：脱敏结果按原文保留协议，不把 webcal 改写成 https。 */
const SCHEME_NAME = /^([a-z][a-z0-9+.-]*):\/\//i;

/**
 * 没被识别成 URL 的凭据参数（`服务端拒绝 token=SECRET`）。
 * 只匹配“参数名 + 等号 + 值”，值到空白、`&` 或 `;` 为止；
 * 参数名是一份保守的白名单，避免把普通正文（如 `code=200`）改成占位符。
 */
const CREDENTIAL_PARAMETER =
  /\b(token|access_token|api_key|apikey|secret|signature|sig|password|passwd|pwd|auth)=([^\s&;]+)/gi;

/**
 * 单个地址的脱敏形式：协议 + 主机 + 路径，查询串与账号信息省略。
 * 协议按原文保留（`webcal://` 不会变成 `https://`——脱敏不改变读者对
 * “这是什么地址”的认识）。解析不了时整段替换为 `fallback`。
 */
export function redactUrl(
  raw: string,
  fallback: string = REDACTED_URL,
): string {
  const rawScheme = SCHEME_NAME.exec(raw)?.[1]?.toLowerCase();
  try {
    // webcal 与 https 的主机 / 路径语义相同，按 https 解析才能拿到规范化结果。
    // http / https 下主机为空本身就是解析失败（`new URL` 会抛），因此没有
    // 单独的“缺主机名”分支。
    const parsed = new URL(raw.replace(/^webcal:/i, "https:"));
    const scheme = rawScheme ?? parsed.protocol.replace(/:$/, "");
    const query = parsed.search === "" ? "" : "?…";
    // 账号信息（user:pass@）不进入结果：只留 host。
    return `${scheme}://${parsed.host}${parsed.pathname}${query}`;
  } catch {
    return fallback;
  }
}

/** 文案里的所有地址按上面的规则脱敏；句子其余部分原样保留。 */
export function redactUrls(text: string): string {
  return text.replace(URL_PATTERN, (match) => {
    const suffix = TRAILING_PUNCTUATION.exec(match)?.[0] ?? "";
    const address = suffix === "" ? match : match.slice(0, -suffix.length);
    return redactUrl(address) + suffix;
  });
}

/** 裸凭据参数按上面的白名单脱敏，只保留参数名。 */
export function redactCredentials(text: string): string {
  return text.replace(CREDENTIAL_PARAMETER, (_match, name: string) => {
    return `${name}=…`;
  });
}

/**
 * 事件正文型字段替换为占位符。
 *
 * 逐字段替换而不是整条丢弃：留下“错误发生在哪一步”仍然可读，
 * 只是看不到标题本身。每个字段同时提供原文与折叠空白两种形态——
 * 错误文案里的标题可能已经被上游折过空白（换行写成空格）。
 */
export function redactEventText(text: string, event: EventTextField): string {
  let result = text;
  for (const value of [
    event.title,
    event.normalizedTitle,
    event.description,
    event.location,
  ]) {
    for (const variant of textVariants(value)) {
      result = result.split(variant).join(REDACTED_EVENT_TEXT);
    }
  }
  return result;
}

/** 一个正文型字段参与替换的形态：原文 + 折叠空白后的写法。 */
function textVariants(value: string | undefined): string[] {
  if (value === undefined || value.length < MIN_REDACTABLE_LENGTH) {
    return [];
  }
  const folded = foldWhitespace(value);
  return folded !== value && folded.length >= MIN_REDACTABLE_LENGTH
    ? [value, folded]
    : [value];
}

function foldWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** 文案清洗：折叠空白 → 脱敏地址与裸凭据 → 截断。两条入口共用。 */
function sanitize(text: string, fallback: string): string {
  const folded = foldWhitespace(text);
  const safe = redactCredentials(redactUrls(folded === "" ? fallback : folded));
  return safe.length <= MAX_MESSAGE_LENGTH
    ? safe
    : `${safe.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
}

/**
 * 纯文案的清洗入口：已经有消息正文（不是异常对象）时用它，
 * 免得调用方各写一遍“折叠 + 脱敏 + 截断”，或干脆漏掉其中一步。
 */
export function sanitizeMessage(text: string = ""): string {
  return sanitize(text, "");
}

/** 任意异常 → 单行文案：脱敏、截断；空消息回落到通用说明。 */
export function describeSafeError(error: unknown): string {
  return sanitize(errorMessageOf(error), FALLBACK_MESSAGE);
}

/** 异常类型名：日志里比 "Error" 更多的那点信息。 */
export function errorNameOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return "未知异常";
  }
  return error.name === "" ? "Error" : error.name;
}

/**
 * 事件相关失败的统一描述（Matcher / Resolver 错误报告的形状）：
 * 异常名 + 已脱敏文案。调用点持有事件，脱敏因此发生在报告生成处，
 * 而不是等某个消费方记得处理。
 */
export function describeEventError(
  error: unknown,
  event: EventTextField,
): SanitizedError {
  const raw = errorMessageOf(error);
  // 先按原文抹掉正文（标题自身可能带换行），折叠后再抹一遍
  // （文案里的标题可能已被折过空白），最后才截断。
  const redacted = redactEventText(
    foldWhitespace(redactEventText(raw, event)),
    event,
  );
  return {
    errorName: errorNameOf(error),
    message: sanitize(redacted, FALLBACK_MESSAGE),
  };
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
