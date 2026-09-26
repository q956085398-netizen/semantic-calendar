/**
 * RRULE 解析（SC-008 / ICS-004 常见规则）。
 *
 * 只接受能被展开器精确兑现的规则；含未支持语义部分（BYSETPOS 等）时
 * 返回 undefined，调用方降级为单次事件，避免展示错误的重复（P-01）。
 */

import { parseIcsCompactDate } from "./ics-dates";

export type RruleFreq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

/** BYDAY 条目；weekday 用 0=周一 … 6=周日，ordinal 仅 MONTHLY 使用。 */
export interface ByDay {
  weekday: number;
  ordinal?: number;
}

export interface RruleUntil {
  /** 规范化 ISO：UTC 形态带 .000Z，纯日期为 YYYY-MM-DD。 */
  value: string;
  utc: boolean;
}

export interface ParsedRrule {
  freq: RruleFreq;
  /** 默认 1。 */
  interval: number;
  count?: number;
  until?: RruleUntil;
  byDay?: ByDay[];
  byMonthDay?: number[];
}

/** 无法精确兑现、宁可降级也不误展开的部分。 */
const UNSUPPORTED_PARTS = new Set([
  "BYSETPOS",
  "BYWEEKNO",
  "BYYEARDAY",
  "BYMONTH",
]);

const FREQS: readonly RruleFreq[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

const WEEKDAY_ENTRY = /^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/;

/**
 * 解析 RRULE 值文本。返回 undefined 表示无法安全解释（降级为单次事件）。
 * 大小写不敏感（RFC 5545）；未知但无害的部分（如 X- 扩展）忽略。
 */
export function parseRrule(text: string): ParsedRrule | undefined {
  const parts = text.trim().split(";");
  if (parts.length === 0 || parts[0] === "") {
    return undefined;
  }

  let freq: RruleFreq | undefined;
  let interval = 1;
  let count: number | undefined;
  let until: RruleUntil | undefined;
  let byDay: ByDay[] | undefined;
  let byMonthDay: number[] | undefined;

  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) {
      return undefined;
    }
    const key = part.slice(0, eq).trim().toUpperCase();
    const value = part.slice(eq + 1).trim();
    if (value === "") {
      return undefined;
    }

    if (UNSUPPORTED_PARTS.has(key)) {
      return undefined;
    }

    switch (key) {
      case "FREQ": {
        const upper = value.toUpperCase();
        freq = FREQS.find((candidate) => candidate === upper);
        if (freq === undefined) {
          return undefined;
        }
        break;
      }
      case "INTERVAL": {
        const parsed = parsePositiveInt(value);
        if (parsed === undefined) {
          return undefined;
        }
        interval = parsed;
        break;
      }
      case "COUNT": {
        const parsed = parsePositiveInt(value);
        if (parsed === undefined) {
          return undefined;
        }
        count = parsed;
        break;
      }
      case "UNTIL": {
        const parsed = parseUntil(value);
        if (parsed === undefined) {
          return undefined;
        }
        until = parsed;
        break;
      }
      case "WKST": {
        // 周起始只支持默认的周一；其他值会改变 INTERVAL 的周对齐，
        // 拒绝整个规则而不是按周一悄悄错算（P-01）。
        if (value.trim().toUpperCase() !== "MO") {
          return undefined;
        }
        break;
      }
      case "BYDAY": {
        const entries: ByDay[] = [];
        for (const token of value.toUpperCase().split(",")) {
          const match = WEEKDAY_ENTRY.exec(token.trim());
          if (!match) {
            return undefined;
          }
          const weekday = WEEKDAYS.indexOf(
            match[2] as (typeof WEEKDAYS)[number],
          );
          let ordinal: number | undefined;
          if (match[1] !== undefined) {
            ordinal = Number(match[1]);
            if (ordinal === 0) {
              return undefined;
            }
          }
          entries.push({
            weekday,
            ...(ordinal !== undefined && { ordinal }),
          });
        }
        if (entries.length === 0) {
          return undefined;
        }
        byDay = entries;
        break;
      }
      case "BYMONTHDAY": {
        const entries: number[] = [];
        for (const token of value.split(",")) {
          const day = Number(token.trim());
          if (!Number.isInteger(day) || day === 0 || Math.abs(day) > 31) {
            return undefined;
          }
          entries.push(day);
        }
        if (entries.length === 0) {
          return undefined;
        }
        byMonthDay = entries;
        break;
      }
      default:
        // 未知部分：RFC 允许扩展，忽略不影响已支持语义。
        break;
    }
  }

  if (freq === undefined) {
    return undefined;
  }
  // 展开器无法精确兑现的组合整体拒绝（P-01：宁可降级为单次也不错展开）。
  // - YEARLY + BYDAY/BYMONTHDAY：语义是“每年第 N 个平日 / 每月某日”，未实现；
  // - DAILY/WEEKLY + BYMONTHDAY：RFC 非法或无意义。
  if (freq === "YEARLY" && (byDay !== undefined || byMonthDay !== undefined)) {
    return undefined;
  }
  if ((freq === "DAILY" || freq === "WEEKLY") && byMonthDay !== undefined) {
    return undefined;
  }
  return {
    freq,
    interval,
    ...(count !== undefined && { count }),
    ...(until !== undefined && { until }),
    ...(byDay !== undefined && { byDay }),
    ...(byMonthDay !== undefined && { byMonthDay }),
  };
}

function parsePositiveInt(value: string): number | undefined {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined;
  }
  return parsed;
}

function parseUntil(value: string): RruleUntil | undefined {
  const parsed = parseIcsCompactDate(value);
  return parsed === undefined
    ? undefined
    : { value: parsed.iso, utc: parsed.utc };
}
