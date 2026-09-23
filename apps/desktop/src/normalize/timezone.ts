/**
 * 时区换算（SC-008 / ICS-003）：TZID 墙钟时间 → UTC 瞬时。
 *
 * 使用 Intl DateTimeFormat 内置的 IANA tzdata 做偏移探测（Node 与
 * WebView2 均带完整 ICU），不引入额外依赖，也不依赖运行机器时区。
 * 两遍探测保证夏令时切换边界上的偏移取值收敛。
 */

const WALL_CLOCK_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tzid: string): Intl.DateTimeFormat {
  // 非法时区名在构造时抛 RangeError，由调用方降级处理。
  let formatter = formatterCache.get(tzid);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tzid,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(tzid, formatter);
  }
  return formatter;
}

/** tzid 在给定瞬时相对 UTC 的偏移（毫秒）。 */
function timezoneOffsetMs(tzid: string, instant: Date): number {
  const parts = formatterFor(tzid).formatToParts(instant);
  const record: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      record[part.type] = Number(part.value);
    }
  }
  const asUtc = Date.UTC(
    record.year,
    record.month - 1,
    record.day,
    record.hour,
    record.minute,
    record.second,
  );
  return asUtc - instant.getTime();
}

/**
 * IANA 时区的墙钟时间 → UTC ISO（…:ss.000Z，与解析器的 UTC 形态一致）。
 * 非法时区名或墙钟格式抛 RangeError；夏令时跳变产生的不存在 /
 * 重复墙钟时间按两遍探测结果取确定值（RFC 5545 允许实现自选）。
 */
export function wallClockToUtcIso(wallIso: string, tzid: string): string {
  const match = WALL_CLOCK_PATTERN.exec(wallIso);
  if (!match) {
    throw new RangeError(`墙钟时间必须是 YYYY-MM-DDTHH:MM:SS，收到 ${wallIso}`);
  }
  const naiveMs = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );

  // 第一遍按“假装是 UTC”的瞬时取偏移，回推候选瞬时后再校验一次；
  // 若两遍偏移一致（绝大多数情况）即收敛，否则用第二次偏移定值。
  const firstOffset = timezoneOffsetMs(tzid, new Date(naiveMs));
  const candidate = new Date(naiveMs - firstOffset);
  const secondOffset = timezoneOffsetMs(tzid, candidate);
  const utcMs =
    firstOffset === secondOffset
      ? candidate.getTime()
      : naiveMs - timezoneOffsetMs(tzid, new Date(naiveMs - secondOffset));

  const shifted = new Date(utcMs);
  const iso = shifted.toISOString();
  return iso;
}
