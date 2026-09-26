import { describe, expect, it } from "vitest";
import { dateFromKey } from "../calendar/month-grid";
import { formatDateTime, localTimeLabel, localWeekdayLabel } from "./time";

/**
 * 本地时间格式化（SC-020 起带缓存）。
 *
 * 断言刻意不绑定运行机器的时区：只验证形状、稳定性与非法输入的降级——
 * 具体时刻的正确性由 occurrence 展开与分桶的测试覆盖（那里有固定样例）。
 */
describe("本地时间格式化", () => {
  it("UTC 瞬时按本地时区输出 HH:mm", () => {
    expect(localTimeLabel("2026-10-18T13:00:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
  });

  it("同一输入的重复调用结果稳定（格式化器被复用）", () => {
    const first = localTimeLabel("2026-10-18T13:00:00.000Z");
    const second = localTimeLabel("2026-10-18T13:00:00.000Z");
    expect(second).toBe(first);
  });

  it("非法输入原样返回，不把 Invalid Date 漏进界面", () => {
    expect(localTimeLabel("不是时间")).toBe("不是时间");
    expect(formatDateTime("不是时间")).toBe("不是时间");
  });

  it("日期 + 时间包含年月与时刻", () => {
    expect(formatDateTime("2026-10-18T13:00:00.000Z")).toContain("2026");
  });

  it("星期几取本地日期（2026-10-18 是周日）", () => {
    expect(localWeekdayLabel(dateFromKey("2026-10-18"))).toBe("Sunday");
  });
});
