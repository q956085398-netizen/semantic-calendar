/**
 * ICS 紧凑日期值解析（EXDATE / RECURRENCE-ID / UNTIL 原值共用）。
 *
 * 形态：YYYYMMDD / YYYYMMDDTHHMMSS / YYYYMMDDTHHMMSSZ。
 * 输出规范化 ISO；“是否 UTC 形态”独立标记，供比较空间选择。
 */

export interface IcsCompactDate {
  /** YYYY-MM-DD 或 YYYY-MM-DDTHH:MM:SS（Z 形态带 .000Z）。 */
  iso: string;
  /** 日期部分 YYYY-MM-DD。 */
  date: string;
  utc: boolean;
}

export function parseIcsCompactDate(value: string): IcsCompactDate | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(
    value.trim(),
  );
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute, second, zulu] = match;
  const date = `${year}-${month}-${day}`;
  if (hour === undefined) {
    return { iso: date, date, utc: false };
  }
  const iso = `${date}T${hour}:${minute}:${second}${zulu === "Z" ? ".000Z" : ""}`;
  return { iso, date, utc: zulu === "Z" };
}
