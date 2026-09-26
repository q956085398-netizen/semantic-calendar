import { describe, expect, it } from "vitest";
import {
  canRequestNotificationPermission,
  describeNotificationStatus,
  formatReminderTime,
} from "./notification-status";

/** SC-017 / app-spec §13：状态文案与“请求授权”入口的判据。 */

describe("通知状态文案（app-spec §13）", () => {
  const now = new Date(2026, 8, 23, 12, 0).getTime();

  it("关闭 / 预览 / 拒绝 / 待确认各有明确说法", () => {
    const base = {
      enabled: true,
      permission: "granted" as const,
      pendingCount: 0,
      next: null,
      nowMs: now,
    };

    expect(describeNotificationStatus({ ...base, enabled: false })).toContain(
      "通知已关闭",
    );
    expect(
      describeNotificationStatus({ ...base, permission: "unsupported" }),
    ).toContain("浏览器预览模式");
    expect(
      describeNotificationStatus({ ...base, permission: "denied" }),
    ).toContain("系统通知权限被拒绝");
    expect(
      describeNotificationStatus({ ...base, permission: "prompt" }),
    ).toContain("待确认");
    expect(
      describeNotificationStatus({ ...base, permission: "unknown" }),
    ).toContain("正在读取");
    expect(describeNotificationStatus(base)).toContain("没有待触发的提醒");
  });

  it("有下一条提醒时写出时间与标题", () => {
    const text = describeNotificationStatus({
      enabled: true,
      permission: "granted",
      pendingCount: 1,
      next: {
        fireAtMs: new Date(2026, 8, 23, 19, 30).getTime(),
        title: "Arsenal vs Manchester City",
      },
      nowMs: now,
    });

    expect(text).toContain("下一条提醒");
    expect(text).toContain("今天 19:30");
    expect(text).toContain("Arsenal vs Manchester City");
    expect(text).not.toContain("待触发）");
  });

  it("还有别的待触发提醒时写出条数", () => {
    const text = describeNotificationStatus({
      enabled: true,
      permission: "granted",
      pendingCount: 3,
      next: {
        fireAtMs: new Date(2026, 8, 23, 19, 30).getTime(),
        title: "周会",
      },
      nowMs: now,
    });

    expect(text).toContain("共 3 条待触发");
  });

  it("发送失败说明优先于“一切正常”的状态", () => {
    const text = describeNotificationStatus({
      enabled: true,
      permission: "granted",
      pendingCount: 0,
      next: null,
      nowMs: now,
      problem: "系统通知未能弹出：系统拒绝",
    });

    expect(text).toBe("系统通知未能弹出：系统拒绝");
  });

  it("提醒时刻按今天 / 明天 / 月日表述", () => {
    expect(
      formatReminderTime(new Date(2026, 8, 23, 19, 30).getTime(), now),
    ).toBe("今天 19:30");
    expect(formatReminderTime(new Date(2026, 8, 24, 9, 0).getTime(), now)).toBe(
      "明天 09:00",
    );
    expect(
      formatReminderTime(new Date(2026, 9, 18, 23, 30).getTime(), now),
    ).toBe("10月18日 23:30");
  });
});

describe("请求授权的入口判据", () => {
  it("通知开启且系统还没给出明确结果时才需要入口", () => {
    expect(canRequestNotificationPermission("prompt", true)).toBe(true);
    expect(canRequestNotificationPermission("denied", true)).toBe(true);
    expect(canRequestNotificationPermission("granted", true)).toBe(false);
    expect(canRequestNotificationPermission("unsupported", true)).toBe(false);
    expect(canRequestNotificationPermission("unknown", true)).toBe(false);
    // 通知已关闭时不必再请求权限。
    expect(canRequestNotificationPermission("prompt", false)).toBe(false);
    expect(canRequestNotificationPermission("denied", false)).toBe(false);
  });
});
