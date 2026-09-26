import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEBCAL_INTERVAL_MINUTES,
  WEBCAL_INTERVAL_OPTIONS,
  WEBCAL_INTERVAL_SETTING_KEY,
  describeWebcalRefreshPolicy,
  normalizeWebcalIntervalMinutes,
  webcalIntervalMs,
} from "./webcal-interval";
import {
  WEBCAL_REFRESH_INTERVAL_MS,
  WEBCAL_RETRY_INTERVAL_MS,
} from "../data/webcal/refresh-scheduler";

/**
 * WebCal 刷新间隔设置（SC-018 / app-spec §12）。
 *
 * 只接受选项内的取值：快照可以被手工改写，表外的数字按默认处理，
 * 不四舍五入到最近选项（P-03）。默认值必须与调度器基线一致，
 * 否则“没设置过”的用户会得到与文档不同的刷新频率。
 */

describe("normalizeWebcalIntervalMinutes", () => {
  it("选项内取值原样返回", () => {
    for (const option of WEBCAL_INTERVAL_OPTIONS) {
      expect(normalizeWebcalIntervalMinutes(option.minutes)).toBe(
        option.minutes,
      );
    }
  });

  it("缺失、坏值与表外数字按默认处理", () => {
    for (const value of [undefined, null, "360", 0, -60, 120, 5, {}, []]) {
      expect(normalizeWebcalIntervalMinutes(value)).toBe(
        DEFAULT_WEBCAL_INTERVAL_MINUTES,
      );
    }
  });

  it("默认值与调度器基线一致（不设置时行为与 SC-007 相同）", () => {
    expect(DEFAULT_WEBCAL_INTERVAL_MINUTES).toBe(
      WEBCAL_REFRESH_INTERVAL_MS / (60 * 1000),
    );
  });

  it("持久化键与文档口径一致（改名会让旧快照读不出间隔）", () => {
    expect(WEBCAL_INTERVAL_SETTING_KEY).toBe("webcal.refreshIntervalMinutes");
  });
});

describe("取值换算与说明", () => {
  it("分钟换算为毫秒", () => {
    expect(webcalIntervalMs(60)).toBe(60 * 60 * 1000);
  });

  it("说明同时给出所选间隔与固定的失败重试间隔", () => {
    const text = describeWebcalRefreshPolicy(1440);
    expect(text).toContain("每天自动检查订阅");
    expect(text).toContain(String(WEBCAL_RETRY_INTERVAL_MS / (60 * 1000)));
  });

  it("选项按从短到长排列，没有重复取值", () => {
    const minutes = WEBCAL_INTERVAL_OPTIONS.map((option) => option.minutes);
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);
    expect(new Set(minutes).size).toBe(minutes.length);
  });
});
