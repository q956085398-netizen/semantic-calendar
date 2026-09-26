import { describe, expect, it } from "vitest";
import {
  FIRED_REMINDER_RETENTION_DAYS,
  FIRED_REMINDERS_SETTING_KEY,
  MAX_FIRED_REMINDERS,
  handledReminderIds,
  markReminderHandled,
  pruneHandledReminders,
  readHandledReminders,
  type HandledReminder,
} from "./fired-reminders";

/**
 * SC-017 / NOTIFY-004：去重日志。
 * 日志是“哪些提醒已经弹过”的状态，不是历史记录，因此必须能裁剪、能收敛。
 */

const T0 = Date.parse("2026-09-23T12:00:00.000Z");

describe("已处理提醒日志（NOTIFY-004）", () => {
  it("记录一条提醒并读回", () => {
    const log = markReminderHandled(
      [],
      { id: "a", at: new Date(T0).toISOString(), outcome: "fired" },
      T0,
    );

    expect(log).toHaveLength(1);
    expect(handledReminderIds(log).has("a")).toBe(true);
  });

  it("同一条提醒重复记录只保留一条", () => {
    const first = markReminderHandled(
      [],
      { id: "a", at: new Date(T0).toISOString(), outcome: "fired" },
      T0,
    );
    const second = markReminderHandled(
      first,
      { id: "a", at: new Date(T0 + 1000).toISOString(), outcome: "expired" },
      T0 + 1000,
    );

    expect(second).toHaveLength(1);
    expect(second[0].outcome).toBe("expired");
  });

  it("超过保留期的条目被裁剪", () => {
    const old = new Date(
      T0 - (FIRED_REMINDER_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000,
    ).toISOString();
    const fresh = new Date(T0 - 1000).toISOString();
    const log: HandledReminder[] = [
      { id: "old", at: old, outcome: "fired" },
      { id: "fresh", at: fresh, outcome: "fired" },
    ];

    expect(pruneHandledReminders(log, T0).map((entry) => entry.id)).toEqual([
      "fresh",
    ]);
  });

  it("超量时保留最新的若干条", () => {
    const total = MAX_FIRED_REMINDERS + 20;
    const log: HandledReminder[] = Array.from(
      { length: total },
      (_, index) => ({
        id: `id-${index}`,
        at: new Date(T0 - (total - index) * 1000).toISOString(),
        outcome: "fired" as const,
      }),
    );

    const pruned = pruneHandledReminders(log, T0);
    expect(pruned).toHaveLength(MAX_FIRED_REMINDERS);
    expect(pruned.at(-1)?.id).toBe(`id-${total - 1}`);
  });

  it("磁盘上的坏值被丢弃，不影响其余条目", () => {
    expect(readHandledReminders(undefined)).toEqual([]);
    expect(readHandledReminders("nope")).toEqual([]);
    expect(
      readHandledReminders([
        { id: "ok", at: "2026-09-23T12:00:00.000Z", outcome: "fired" },
        { id: "", at: "2026-09-23T12:00:00.000Z", outcome: "fired" },
        { id: "no-outcome", at: "2026-09-23T12:00:00.000Z" },
        { id: "bad-time", at: "不是时间", outcome: "fired" },
        { id: 42, at: "2026-09-23T12:00:00.000Z", outcome: "fired" },
      ]),
    ).toEqual([{ id: "ok", at: "2026-09-23T12:00:00.000Z", outcome: "fired" }]);
  });

  it("空日志与坏值都等价于“什么都还没处理过”", () => {
    expect(handledReminderIds([]).size).toBe(0);
    expect(handledReminderIds(null).size).toBe(0);
  });

  it("设置键名与快照命名空间一致", () => {
    expect(FIRED_REMINDERS_SETTING_KEY).toBe("notifications.firedReminders");
  });
});
