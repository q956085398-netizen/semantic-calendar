import { describe, expect, it } from "vitest";
import {
  NO_DAY_BACKDROPS,
  dayBackdropUrl,
  type DayBackdropSource,
} from "./day-backdrop";

/**
 * 日级语义背景资源解析测试（SC-012：UI 背景资源引用接口）。
 *
 * 验收口径：资源包缺失、未收录该引用、资源包自身抛错，三种情况都确定性地
 * 降级为「没有背景」，UI 永远拿到 undefined 而不是异常；文字与语义色照常。
 */

const PACK: DayBackdropSource = {
  urlFor: (ref) =>
    ref === "bg.solar-term.cold-dew" ? "/assets/cold-dew.webp" : undefined,
};

describe("日级语义背景解析（SC-012）", () => {
  it("资源包收录的引用返回资源地址", () => {
    expect(dayBackdropUrl("bg.solar-term.cold-dew", PACK)).toBe(
      "/assets/cold-dew.webp",
    );
  });

  it("未收录的引用与没有引用都返回 undefined", () => {
    expect(
      dayBackdropUrl("bg.festival.mid-autumn-festival", PACK),
    ).toBeUndefined();
    expect(dayBackdropUrl(undefined, PACK)).toBeUndefined();
    expect(dayBackdropUrl("", PACK)).toBeUndefined();
  });

  it("默认资源包不附带任何图片", () => {
    expect(dayBackdropUrl("bg.solar-term.cold-dew")).toBeUndefined();
    expect(
      dayBackdropUrl("bg.solar-term.cold-dew", NO_DAY_BACKDROPS),
    ).toBeUndefined();
  });

  it("资源包抛错按「没有背景」处理，不向调用方冒泡", () => {
    const broken: DayBackdropSource = {
      urlFor: () => {
        throw new Error("资源包坏了");
      },
    };
    expect(dayBackdropUrl("bg.solar-term.cold-dew", broken)).toBeUndefined();
  });

  it("资源包返回空地址按「没有背景」处理", () => {
    const empty: DayBackdropSource = { urlFor: () => "" };
    expect(dayBackdropUrl("bg.solar-term.cold-dew", empty)).toBeUndefined();
  });
});
