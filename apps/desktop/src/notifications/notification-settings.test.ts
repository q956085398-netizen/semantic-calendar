import { describe, expect, it } from "vitest";
import {
  MATCH_REMINDER_SETTING_KEY,
  NOTIFICATIONS_ENABLED_SETTING_KEY,
  matchReminderOptionLabel,
  matchReminderOptionValue,
  matchReminderOptions,
  matchReminderOptionsFor,
  matchReminderSettingFromOption,
  normalizeMatchReminderSetting,
  normalizeNotificationsEnabled,
} from "./notification-settings";

/** SC-017 / NOTIFY-001–003：通知设置的规范化与表单映射（纯逻辑，UI 只负责画）。 */

describe("通知设置（NOTIFY-001 / NOTIFY-003）", () => {
  it("默认开启；只有明确的 false 才是关闭", () => {
    expect(normalizeNotificationsEnabled(undefined)).toBe(true);
    expect(normalizeNotificationsEnabled(false)).toBe(false);
    expect(normalizeNotificationsEnabled(true)).toBe(true);
    expect(normalizeNotificationsEnabled("no")).toBe(true);
  });

  it("比赛提醒提前量区分“跟随默认 / 数字 / 不提醒”", () => {
    expect(normalizeMatchReminderSetting(undefined)).toBeUndefined();
    expect(normalizeMatchReminderSetting(15)).toBe(15);
    expect(normalizeMatchReminderSetting(null)).toBeNull();
  });

  it("坏值回落到“跟随默认建议”，而不是猜一个分钟数", () => {
    expect(normalizeMatchReminderSetting("15")).toBeUndefined();
    expect(normalizeMatchReminderSetting(0)).toBeUndefined();
    expect(normalizeMatchReminderSetting(-30)).toBeUndefined();
    expect(normalizeMatchReminderSetting(Number.NaN)).toBeUndefined();
    expect(
      normalizeMatchReminderSetting(Number.POSITIVE_INFINITY),
    ).toBeUndefined();
  });

  it("表单取值与设置值互转", () => {
    expect(matchReminderOptionValue(undefined)).toBe("default");
    expect(matchReminderOptionValue(null)).toBe("off");
    expect(matchReminderOptionValue(45)).toBe("45");

    expect(matchReminderSettingFromOption("default")).toBeUndefined();
    expect(matchReminderSettingFromOption("off")).toBeNull();
    expect(matchReminderSettingFromOption("60")).toBe(60);
    expect(matchReminderSettingFromOption("0")).toBeUndefined();
    expect(matchReminderSettingFromOption("abc")).toBeUndefined();
  });

  it("默认选项带上 Resolver 的建议文案（默认值只有一处来源）", () => {
    const options = matchReminderOptions("赛前 30 分钟");

    expect(options[0]).toEqual({
      value: "default",
      label: "跟随默认建议（赛前 30 分钟）",
    });
    expect(matchReminderOptions()[0].label).toBe("跟随默认建议");
    expect(options.map((option) => option.value)).toEqual([
      "default",
      "60",
      "30",
      "15",
      "10",
      "off",
    ]);
  });

  it("自定义分钟数在表单里也能显示成一句人话", () => {
    expect(matchReminderOptionLabel(45)).toBe("提前 45 分钟");
    expect(matchReminderOptionLabel(null)).toBe("不提醒");
    expect(matchReminderOptionLabel(undefined, "赛前 30 分钟")).toBe(
      "跟随默认建议（赛前 30 分钟）",
    );
  });

  it("自定义分钟数会补进下拉选项，不出现空白选中项", () => {
    const preset = matchReminderOptions().map((option) => option.value);

    expect(matchReminderOptionsFor(undefined).map((o) => o.value)).toEqual(
      preset,
    );
    expect(matchReminderOptionsFor(15)).toEqual(matchReminderOptions());

    const custom = matchReminderOptionsFor(45);
    expect(custom.at(-1)).toEqual({ value: "45", label: "提前 45 分钟" });
    expect(custom.slice(0, -1)).toEqual(matchReminderOptions());
  });

  it("设置键名固定，SC-018 设置页复用同一套键", () => {
    expect(NOTIFICATIONS_ENABLED_SETTING_KEY).toBe("notifications.enabled");
    expect(MATCH_REMINDER_SETTING_KEY).toBe(
      "notifications.matchReminderMinutes",
    );
  });
});
