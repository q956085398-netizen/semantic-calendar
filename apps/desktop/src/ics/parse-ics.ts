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

import type { EventAlarm, ExdateValue, RawCalendarEvent } from "../data/model";
import { isChunkBoundary } from "../scheduling/chunk-boundary";

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

/**
 * 展开 RFC 5545 折叠行：以空格 / 制表符开头的行拼回上一行。
 *
 * 分片进行（SC-024）：折叠状态就在 `lines` 的末行上，因此片边界落在折叠组
 * 中间时结果不变。文本切分本身（一次 `split`）不分片：10,000 条约 4 ms，
 * 在一帧以内（见 performance.md §3.5）。
 */
function* unfoldLinesInChunks(
  text: string,
  chunkLines: number,
): Generator<void, string[], void> {
  const normalized = text.replace(/^\uFEFF/, "");
  const rawLines = normalized.split(/\r\n|\r|\n/);
  const lines: string[] = [];
  for (let index = 0; index < rawLines.length; index += 1) {
    if (isChunkBoundary(index, chunkLines)) {
      yield;
    }
    const line = rawLines[index];
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/**
 * 「这是不是一个 ICS 文件」的预检：逐行扫描，命中即返回。
 * 分片进行：文件里若有一大段前置组件（VTIMEZONE 等），这趟扫描同样是全量遍历，
 * 不能留成一次不可中断的任务。
 */
function* looksLikeIcsInChunks(
  lines: readonly string[],
  chunkLines: number,
): Generator<void, boolean, void> {
  for (let index = 0; index < lines.length; index += 1) {
    if (isChunkBoundary(index, chunkLines)) {
      yield;
    }
    const upper = lines[index].trim().toUpperCase();
    if (upper === "BEGIN:VCALENDAR" || upper === "BEGIN:VEVENT") {
      return true;
    }
  }
  return false;
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
 * DURATION → 毫秒（保留符号）；格式非法返回 null。
 * 同一份解析供 DTEND 推算与 VALARM 的 TRIGGER 使用。
 */
function parseDurationMs(value: string): number | null {
  const match = DURATION.exec(value.trim());
  if (!match) {
    return null;
  }
  const weeks = Number(match[2] ?? 0);
  const days = Number(match[3] ?? 0);
  const hours = Number(match[4] ?? 0);
  const minutes = Number(match[5] ?? 0);
  const seconds = Number(match[6] ?? 0);
  const totalMs =
    (((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 * 1000 +
    seconds * 1000;
  return match[1] === "-" ? -totalMs : totalMs;
}

/**
 * DURATION → 结束时间。以“墙上时钟”做加法（UTC 分量容器），
 * 浮动时间与 UTC 语义下都正确，且不依赖运行机器时区。
 */
function applyDuration(start: IcsDateTime, duration: string): IcsDateTime {
  const delta = parseDurationMs(duration);
  if (delta === null) {
    throw new Error(`DURATION 格式非法：${duration}`);
  }

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
 * 收集属性：同名属性取第一个（ICS 惯例）。
 * 顶层 VEVENT 属性与 VALARM 属性共用同一份规则。
 */
function collectProperties(
  lines: readonly string[],
): Map<string, { params: Record<string, string>; value: string }> {
  const properties = new Map<
    string,
    { params: Record<string, string>; value: string }
  >();
  for (const line of lines) {
    const parsed = parseContentLine(line);
    if (parsed === null || properties.has(parsed.name)) {
      continue;
    }
    properties.set(parsed.name, {
      params: parsed.params,
      value: parsed.value,
    });
  }
  return properties;
}

/** RRULE / EXDATE 收集；重复给出 RRULE 时以最后一条为准。 */
function collectRecurrence(lines: readonly string[]): {
  rrule?: string;
  exdates: ExdateValue[];
} {
  const exdates: ExdateValue[] = [];
  let rrule: string | undefined;
  for (const line of lines) {
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
    }
  }
  return { rrule, exdates };
}

/**
 * VALARM → 事件自带提醒（SC-017 / NOTIFY-002）。
 *
 * 只解释“相对时间”的 TRIGGER（-PT30M / -P1D 等，RFC 5545 的主流写法），
 * 并且只接收 ACTION:DISPLAY（或未声明 ACTION）：绝对时间 TRIGGER
 * （VALUE=DATE-TIME）与 EMAIL / AUDIO 类动作都不产生本地提醒——
 * 宁可不提醒，也不按错误的时间弹窗（P-03）。
 */
function parseValarm(lines: readonly string[]): EventAlarm | null {
  const properties = collectProperties(lines);
  const trigger = properties.get("TRIGGER");
  if (trigger === undefined) {
    return null;
  }
  if (trigger.params.VALUE?.toUpperCase() === "DATE-TIME") {
    return null;
  }
  const action = properties.get("ACTION")?.value.trim().toUpperCase();
  if (action !== undefined && action !== "DISPLAY") {
    return null;
  }
  const deltaMs = parseDurationMs(trigger.value);
  if (deltaMs === null) {
    return null;
  }
  return {
    minutes: Math.abs(deltaMs) / 60_000,
    direction: deltaMs <= 0 ? "before" : "after",
    related: trigger.params.RELATED?.toUpperCase() === "END" ? "end" : "start",
  };
}

/**
 * 提取 VEVENT 的（已展开）原始行。
 * 用组件栈做严格配对：截断文件里 END:VCALENDAR 不会“替”VEVENT 闭合，
 * 未闭合的 VEVENT 计入 unclosed，由调用方报告而不是静默丢弃。
 *
 * 分片进行（SC-024）：组件栈、当前块与未闭合计数都跨片保留，片边界因此
 * 不改变任何一条块的内容与顺序。
 */
function* extractVeventBlocksInChunks(
  lines: readonly string[],
  chunkLines: number,
): Generator<void, { blocks: string[][]; unclosed: number }, void> {
  const blocks: string[][] = [];
  const stack: string[] = [];
  let body: string[] | null = null;
  let unclosed = 0;

  for (let index = 0; index < lines.length; index += 1) {
    if (isChunkBoundary(index, chunkLines)) {
      yield;
    }
    const line = lines[index];
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
 *
 * 同步入口：就是这个生成器的一次排空，因此两条路径不可能各自演化出
 * 不同的语义（与 normalize/occurrences.ts 的分片入口同一形状）。
 */
export function parseIcsCalendar(text: string): IcsParseResult {
  const steps = parseIcsCalendarInChunks(text);
  let step = steps.next();
  while (!step.done) {
    step = steps.next();
  }
  return step.value;
}

/**
 * 分片粒度（文本行）：展开折叠行、ICS 预检与切 VEVENT 块都是逐行扫描，
 * 每行约 0.1 µs，粒度因此比逐块解析粗（一片约 0.1 ms）。
 */
export const ICS_CHUNK_LINES = 1024;

/**
 * 分片粒度（VEVENT 块）：解析阶段每这么多块给一个让出点。每条事件的解析
 * 约 10 µs（10,000 条约 100 ms，实测见 performance.md §3.5），与 occurrence
 * 展开的粒度同量级（OCCURRENCE_CHUNK_EVENTS）。
 */
export const ICS_CHUNK_EVENTS = 128;

/**
 * 分片解析（SC-024 / app-spec §15「大量事件不应阻塞 UI 线程」）。
 *
 * 三趟都要能中断，缺一趟都留着一次可感知的停顿（10,000 条的实测：
 * 逐行展开 7.7 ms、切块 13.5 ms、逐块解析 96 ms）。三趟共用同一个让出点
 * 形状：每 chunk 个元素 yield 一次，调用方在 yield 处决定怎么让。
 */
export function* parseIcsCalendarInChunks(
  text: string,
  chunkLines: number = ICS_CHUNK_LINES,
  chunkEvents: number = ICS_CHUNK_EVENTS,
): Generator<void, IcsParseResult, void> {
  const events: ParsedIcsEvent[] = [];
  const issues: IcsParseIssue[] = [];

  const trimmedText = text.trim();
  if (trimmedText === "") {
    return { events, issues: [{ message: "文件为空" }] };
  }

  const lines = yield* unfoldLinesInChunks(text, chunkLines);
  if (!(yield* looksLikeIcsInChunks(lines, chunkLines))) {
    return { events, issues: [{ message: "不是有效的 ICS 日历文件" }] };
  }

  const { blocks, unclosed } = yield* extractVeventBlocksInChunks(
    lines,
    chunkLines,
  );
  if (unclosed > 0) {
    // 截断的最后一个事件按坏事件报告，而不是静默消失（导入错误报告）。
    // 未闭合块必然在所有已闭合块之后，序号即 blocks.length + 1。
    issues.push({ eventIndex: blocks.length + 1, message: "VEVENT 未闭合" });
  }
  for (let position = 0; position < blocks.length; position += 1) {
    if (isChunkBoundary(position, chunkEvents)) {
      yield;
    }
    try {
      events.push(parseVevent(blocks[position]));
    } catch (error) {
      issues.push({
        eventIndex: position + 1,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { events, issues };
}

function parseVevent(bodyLines: string[]): ParsedIcsEvent {
  // 去掉 BEGIN/END:VEVENT 后收集顶层属性；嵌套子组件单独收集：
  // VALARM 解释为事件自带提醒（SC-017），其余（VTIMEZONE 等）只保留原文。
  const inner = bodyLines.slice(1, -1);
  const topLevel: string[] = [];
  const alarms: EventAlarm[] = [];
  const keptLines: string[] = [];
  let skipDepth = 0;
  let nested: { lines: string[] } | null = null;
  for (const line of inner) {
    const upper = line.trim().toUpperCase();
    if (upper.startsWith("BEGIN:")) {
      const component = upper.slice("BEGIN:".length);
      // 嵌套里的嵌套（非标准写法）不参与解释：只收整块原文。
      nested = skipDepth === 0 && component === "VALARM" ? { lines: [] } : null;
      skipDepth += 1;
      keptLines.push(line);
      continue;
    }
    if (upper.startsWith("END:")) {
      skipDepth -= 1;
      keptLines.push(line);
      if (skipDepth === 0 && nested !== null) {
        const alarm = parseValarm(nested.lines);
        if (alarm !== null) {
          alarms.push(alarm);
        }
        nested = null;
      }
      continue;
    }
    keptLines.push(line);
    if (skipDepth > 0) {
      nested?.lines.push(line);
      continue;
    }
    topLevel.push(line);
  }
  const rawPayload = keptLines.join("\n");
  const properties = collectProperties(topLevel);
  const { rrule, exdates } = collectRecurrence(topLevel);

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
    ...(alarms.length > 0 && { alarms }),
    ...(((rrule !== undefined || exdates.length > 0) && {
      recurrence: { rrule, exdates },
    }) as object),
    rawPayload,
  };
}
