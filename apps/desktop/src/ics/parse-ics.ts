/**
 * ICS 解析器（SC-006 / app-spec §9 SRC-001 + ICS-001–005）。
 *
 * 职责边界：
 * - 只做“文本 → RawCalendarEvent 形状”的机械映射，不做语义标准化
 *   （标题清洗、时区精确换算、recurrence 展开均属 SC-008 Normalizer）；
 * - 错误按事件隔离（ICS-005）：坏事件进入 issues，好事件照常返回；
 * - 原始片段完整保留在 rawPayload，Matcher / Normalizer 更新后可重建。
 *
 * 时间映射约定（避免依赖运行机器时区）：
 * - VALUE=DATE 全天：原样保留 YYYY-MM-DD，绝不换算（ICS-002 不漂移）；
 * - Z 结尾：转 ISO UTC（…:ss.000Z）；
 * - 浮动 / TZID 本地时间：转无偏移本地 ISO，TZID 参数原文保留在
 *   startTzid / endTzid / EXDATE 条目上，精确换算由 SC-008 完成。
 */

import type { ExdateValue, RawCalendarEvent } from "../data/model";

/** 单个坏事件的说明；eventIndex 为 1 基 VEVENT 序号，undefined 表示文件级问题。 */
export interface IcsParseIssue {
  eventIndex?: number;
  message: string;
}

/** 解析出的事件：RawCalendarEvent 去掉 sourceId（由导入服务回填）。 */
export type ParsedIcsEvent = Omit<RawCalendarEvent, "sourceId">;

export interface IcsParseResult {
  events: ParsedIcsEvent[];
  issues: IcsParseIssue[];
}

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

const DATE_VALUE = /^\d{8}$/;
const DATE_TIME_UTC = /^\d{8}T\d{6}Z$/;
const DATE_TIME_LOCAL = /^\d{8}T\d{6}$/;
const DURATION =
  /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** 展开 RFC 5545 折叠行：以空格 / 制表符开头的行拼回上一行。 */
function unfoldLines(text: string): string[] {
  const normalized = text.replace(/^\uFEFF/, "");
  const rawLines = normalized.split(/\r\n|\r|\n/);
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/** 解析内容行 `NAME;PARAM=值:value`，引号内的分隔符不生效。 */
function parseContentLine(line: string): ContentLine | null {
  const colon = findUnquoted(line, ":");
  if (colon < 0) {
    return null;
  }
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const segments = splitUnquoted(head, ";");
  // 组前缀（如 item1.SUMMARY）不参与字段识别。
  const name = segments[0]
    .slice(segments[0].lastIndexOf(".") + 1)
    .toUpperCase();

  const params: Record<string, string> = {};
  for (const segment of segments.slice(1)) {
    const eq = findUnquoted(segment, "=");
    if (eq < 0) continue;
    const key = segment.slice(0, eq).toUpperCase();
    const raw = segment.slice(eq + 1);
    params[key] = unquote(raw);
  }
  return { name, params, value };
}

function findUnquoted(text: string, separator: string): number {
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === separator && !inQuotes) {
      return i;
    }
  }
  return -1;
}

function splitUnquoted(text: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      // findUnquoted 已保证引号成对；这里只需跳过引号内部。
      const closing = text.indexOf('"', i + 1);
      i = closing < 0 ? i : closing;
    } else if (char === separator) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') && value.length >= 2
    ? value.slice(1, -1)
    : value;
}

/** RFC 5545 TEXT 转义还原。 */
function unescapeText(value: string): string {
  return value.replace(/\\(.?)/g, (_, char: string) => {
    if (char === "n" || char === "N") return "\n";
    return char;
  });
}

interface IcsDateTime {
  /** YYYY-MM-DD（全天）或带时间的 ISO 形式。 */
  iso: string;
  allDay: boolean;
}

/** 解析 DTSTART / DTEND 值；非法格式抛错，由调用方转为事件级 issue。 */
function parseIcsDateTime(
  value: string,
  params: Record<string, string>,
): IcsDateTime {
  const trimmed = value.trim();
  const isDate =
    params.VALUE?.toUpperCase() === "DATE" || DATE_VALUE.test(trimmed);
  if (isDate) {
    if (!DATE_VALUE.test(trimmed)) {
      throw new Error(`日期格式非法：${value}`);
    }
    const { year, month, day } = parseDateParts(trimmed);
    return { iso: formatIsoDate(year, month, day), allDay: true };
  }
  if (DATE_TIME_UTC.test(trimmed)) {
    const { year, month, day, hour, minute, second } = parseDateTimeParts(
      trimmed.slice(0, 15),
    );
    return {
      iso: `${formatIsoDate(year, month, day)}T${formatIsoTime(hour, minute, second)}.000Z`,
      allDay: false,
    };
  }
  if (DATE_TIME_LOCAL.test(trimmed)) {
    const { year, month, day, hour, minute, second } =
      parseDateTimeParts(trimmed);
    return {
      iso: `${formatIsoDate(year, month, day)}T${formatIsoTime(hour, minute, second)}`,
      allDay: false,
    };
  }
  throw new Error(`时间格式非法：${value}`);
}

function parseDateParts(value: string): {
  year: number;
  month: number;
  day: number;
} {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  // 用 UTC 分量回读校验真实存在（如 20261345 会被拒绝），不引入本地时区。
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`日期不存在：${value}`);
  }
  return { year, month, day };
}

function parseDateTimeParts(value: string) {
  const date = parseDateParts(value.slice(0, 8));
  const hour = Number(value.slice(9, 11));
  const minute = Number(value.slice(11, 13));
  const second = Number(value.slice(13, 15));
  if (hour > 23 || minute > 59 || second > 60) {
    throw new Error(`时间不存在：${value}`);
  }
  return { ...date, hour, minute, second };
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function formatIsoTime(hour: number, minute: number, second: number): string {
  return `${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * DURATION → 结束时间。以“墙上时钟”做加法（UTC 分量容器），
 * 浮动时间与 UTC 语义下都正确，且不依赖运行机器时区。
 */
function applyDuration(start: IcsDateTime, duration: string): IcsDateTime {
  const match = DURATION.exec(duration.trim());
  if (!match) {
    throw new Error(`DURATION 格式非法：${duration}`);
  }
  const negative = match[1] === "-";
  const weeks = Number(match[2] ?? 0);
  const days = Number(match[3] ?? 0);
  const hours = Number(match[4] ?? 0);
  const minutes = Number(match[5] ?? 0);
  const seconds = Number(match[6] ?? 0);
  const totalMs =
    (((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 * 1000 +
    seconds * 1000;
  const delta = negative ? -totalMs : totalMs;

  if (start.allDay) {
    const { year, month, day } = parseIsoDate(start.iso);
    const end = new Date(Date.UTC(year, month - 1, day) + delta);
    return {
      iso: formatIsoDate(
        end.getUTCFullYear(),
        end.getUTCMonth() + 1,
        end.getUTCDate(),
      ),
      allDay: true,
    };
  }

  const isUtc = start.iso.endsWith("Z");
  const wall = parseIsoDateTime(start.iso);
  const end = new Date(
    Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    ) + delta,
  );
  return {
    iso:
      `${formatIsoDate(
        end.getUTCFullYear(),
        end.getUTCMonth() + 1,
        end.getUTCDate(),
      )}T${formatIsoTime(
        end.getUTCHours(),
        end.getUTCMinutes(),
        end.getUTCSeconds(),
      )}` + (isUtc ? ".000Z" : ""),
    allDay: false,
  };
}

function parseIsoDate(iso: string): {
  year: number;
  month: number;
  day: number;
} {
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
  };
}

function parseIsoDateTime(iso: string) {
  return {
    ...parseIsoDate(iso),
    hour: Number(iso.slice(11, 13)),
    minute: Number(iso.slice(14, 16)),
    second: Number(iso.slice(17, 19)),
  };
}

/**
 * 提取 VEVENT 的（已展开）原始行。
 * 用组件栈做严格配对：截断文件里 END:VCALENDAR 不会“替”VEVENT 闭合，
 * 未闭合的 VEVENT 计入 unclosed，由调用方报告而不是静默丢弃。
 */
function extractVeventBlocks(lines: string[]): {
  blocks: string[][];
  unclosed: number;
} {
  const blocks: string[][] = [];
  const stack: string[] = [];
  let body: string[] | null = null;
  let unclosed = 0;

  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper.startsWith("BEGIN:")) {
      const component = upper.slice("BEGIN:".length);
      stack.push(component);
      if (component === "VEVENT" && body === null) {
        body = [line];
        continue;
      }
    } else if (upper.startsWith("END:")) {
      const component = upper.slice("END:".length);
      if (stack.includes(component)) {
        // 向上弹出直到匹配的 BEGIN；中途被带出的 VEVENT 即未闭合。
        for (let top = stack.pop(); top !== component; top = stack.pop()) {
          if (top === "VEVENT" && body !== null) {
            unclosed += 1;
            body = null;
          }
        }
      }
      if (component === "VEVENT" && body !== null) {
        body.push(line);
        blocks.push(body);
        body = null;
        continue;
      }
    }
    if (body !== null) {
      body.push(line);
    }
  }
  if (body !== null) {
    unclosed += 1;
  }
  return { blocks, unclosed };
}

/**
 * 解析 ICS 文本。任何输入都不抛异常：文件级问题与坏事件都进入 issues，
 * 调用方据此决定导入结果与用户反馈（错误隔离，ICS-005）。
 */
export function parseIcsCalendar(text: string): IcsParseResult {
  const events: ParsedIcsEvent[] = [];
  const issues: IcsParseIssue[] = [];
  const lines = unfoldLines(text);

  const trimmedText = text.trim();
  if (trimmedText === "") {
    return { events, issues: [{ message: "文件为空" }] };
  }
  const sawCalendarOrEvent = lines.some((line) => {
    const upper = line.trim().toUpperCase();
    return upper === "BEGIN:VCALENDAR" || upper === "BEGIN:VEVENT";
  });
  if (!sawCalendarOrEvent) {
    return { events, issues: [{ message: "不是有效的 ICS 日历文件" }] };
  }

  const { blocks, unclosed } = extractVeventBlocks(lines);
  if (unclosed > 0) {
    // 截断的最后一个事件按坏事件报告，而不是静默消失（导入错误报告）。
    // 未闭合块必然在所有已闭合块之后，序号即 blocks.length + 1。
    issues.push({ eventIndex: blocks.length + 1, message: "VEVENT 未闭合" });
  }
  blocks.forEach((block, position) => {
    try {
      events.push(parseVevent(block));
    } catch (error) {
      issues.push({
        eventIndex: position + 1,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return { events, issues };
}

function parseVevent(bodyLines: string[]): ParsedIcsEvent {
  const properties = new Map<
    string,
    { params: Record<string, string>; value: string }
  >();
  const exdates: ExdateValue[] = [];
  let rrule: string | undefined;

  // 去掉 BEGIN/END:VEVENT 后收集顶层属性；嵌套子组件（VALARM 等）跳过。
  const inner = bodyLines.slice(1, -1);
  let skipDepth = 0;
  const keptLines: string[] = [];
  for (const line of inner) {
    const upper = line.trim().toUpperCase();
    if (upper.startsWith("BEGIN:")) {
      skipDepth += 1;
      keptLines.push(line);
      continue;
    }
    if (upper.startsWith("END:")) {
      skipDepth -= 1;
      keptLines.push(line);
      continue;
    }
    keptLines.push(line);
    if (skipDepth > 0) {
      continue;
    }
    const parsed = parseContentLine(line);
    if (parsed === null) {
      continue;
    }
    if (parsed.name === "EXDATE") {
      const tzid = parsed.params.TZID;
      for (const value of parsed.value.split(",")) {
        const trimmed = value.trim();
        if (trimmed !== "") {
          exdates.push({
            value: trimmed,
            ...(tzid !== undefined && { tzid }),
          });
        }
      }
      continue;
    }
    if (parsed.name === "RRULE") {
      rrule = parsed.value.trim();
      continue;
    }
    // 同名属性取第一个（ICS 惯例）。
    if (!properties.has(parsed.name)) {
      properties.set(parsed.name, {
        params: parsed.params,
        value: parsed.value,
      });
    }
  }
  const rawPayload = keptLines.join("\n");

  const uid = properties.get("UID")?.value.trim();
  if (!uid) {
    throw new Error("缺少 UID，无法建立持久化身份（ICS-001）");
  }

  const dtstart = properties.get("DTSTART");
  if (!dtstart) {
    throw new Error("缺少 DTSTART，事件没有开始时间");
  }
  let start: IcsDateTime;
  try {
    start = parseIcsDateTime(dtstart.value, dtstart.params);
  } catch (error) {
    throw new Error(
      `DTSTART 无法解析：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let end: string | undefined;
  const dtend = properties.get("DTEND");
  if (dtend) {
    try {
      end = parseIcsDateTime(dtend.value, dtend.params).iso;
    } catch {
      // 结束时间坏不致命：保留开始时间，结束时间丢弃。
      end = undefined;
    }
  } else {
    const duration = properties.get("DURATION");
    if (duration) {
      try {
        end = applyDuration(start, duration.value).iso;
      } catch {
        end = undefined;
      }
    }
  }

  const recurrenceId = properties.get("RECURRENCE-ID");
  let occurrenceId: string | undefined;
  if (recurrenceId) {
    try {
      occurrenceId = parseIcsDateTime(
        recurrenceId.value,
        recurrenceId.params,
      ).iso;
    } catch {
      occurrenceId = recurrenceId.value.trim();
    }
  }

  const cancelled =
    properties.get("STATUS")?.value.trim().toUpperCase() === "CANCELLED";

  const title = unescapeText(properties.get("SUMMARY")?.value ?? "");
  const description = properties.get("DESCRIPTION");
  const location = properties.get("LOCATION");
  const startTzid = dtstart.params.TZID;
  const endTzid = dtend?.params.TZID;

  return {
    uid,
    title,
    ...(description !== undefined && {
      description: unescapeText(description.value),
    }),
    ...(location !== undefined && { location: unescapeText(location.value) }),
    start: start.iso,
    ...(end !== undefined && { end }),
    allDay: start.allDay,
    ...(startTzid !== undefined && { startTzid }),
    ...(endTzid !== undefined && { endTzid }),
    ...(occurrenceId !== undefined && { occurrenceId }),
    ...(cancelled && { cancelled: true }),
    ...(((rrule !== undefined || exdates.length > 0) && {
      recurrence: { rrule, exdates },
    }) as object),
    rawPayload,
  };
}
