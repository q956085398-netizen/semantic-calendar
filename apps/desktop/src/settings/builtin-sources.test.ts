import { describe, expect, it } from "vitest";
import {
  BUILTIN_SOURCES,
  BUILTIN_SOURCES_SETTING_KEY,
  isBuiltinSourceEnabled,
  readHiddenBuiltinSourceIds,
  toggleBuiltinSource,
  type BuiltinSourceId,
} from "./builtin-sources";

/**
 * 内置来源显示开关（SC-018）。
 *
 * 存储形状是“被隐藏的 id 列表”，所以两条边界必须成立：缺失 / 坏值 → 全部
 * 可见（默认全开，与 ui-design §4.3 的四行一致）；未知 id → 丢弃，不能被
 * 当成某个已知来源（P-03）。列表顺序统一规范化，同一组开关只有一种写法。
 */

describe("读取隐藏来源边界", () => {
  it("缺失或非数组 → 全部可见", () => {
    expect(readHiddenBuiltinSourceIds(undefined)).toEqual([]);
    expect(readHiddenBuiltinSourceIds(null)).toEqual([]);
    expect(readHiddenBuiltinSourceIds("cn-holiday")).toEqual([]);
    expect(readHiddenBuiltinSourceIds({})).toEqual([]);
  });

  it("未知 id、坏类型与重复项被丢弃，不猜成某个来源", () => {
    expect(
      readHiddenBuiltinSourceIds([
        "cn-holiday",
        "not-a-source",
        42,
        null,
        "cn-holiday",
        "premier-league",
      ]),
    ).toEqual(["cn-holiday", "premier-league"]);
  });

  it("顺序规范化到目录顺序，与写入顺序无关", () => {
    expect(
      readHiddenBuiltinSourceIds(["premier-league", "cn-holiday", "mine"]),
    ).toEqual(["mine", "cn-holiday", "premier-league"]);
  });

  it("清空列表 → 全部可见（空数组是「都显示」而不是「都隐藏」）", () => {
    expect(readHiddenBuiltinSourceIds([])).toEqual([]);
    expect(
      BUILTIN_SOURCES.every((source) => isBuiltinSourceEnabled([], source.id)),
    ).toBe(true);
  });
});

describe("开关读写", () => {
  const ALL_IDS: BuiltinSourceId[] = BUILTIN_SOURCES.map((source) => source.id);

  it("隐藏一个来源后只有它不可见", () => {
    const hidden = toggleBuiltinSource([], "solar-terms", false);
    expect(hidden).toEqual(["solar-terms"]);
    expect(isBuiltinSourceEnabled(hidden, "solar-terms")).toBe(false);
    expect(isBuiltinSourceEnabled(hidden, "cn-holiday")).toBe(true);
  });

  it("重新显示后从列表移除，不留下重复项", () => {
    const hidden = toggleBuiltinSource(["cn-holiday"], "cn-holiday", true);
    expect(hidden).toEqual([]);
    const twice = toggleBuiltinSource(
      toggleBuiltinSource([], "mine", false),
      "mine",
      true,
    );
    expect(twice).toEqual([]);
  });

  it("全部隐藏 → 列表含全部 id，且顺序稳定", () => {
    let hidden: BuiltinSourceId[] = [];
    for (const id of [...ALL_IDS].reverse()) {
      hidden = toggleBuiltinSource(hidden, id, false);
    }
    expect(hidden).toEqual(ALL_IDS);
    // 目录里没有第五个来源：设置键与目录必须同时增加（这里守住这个契约）。
    expect(BUILTIN_SOURCES).toHaveLength(4);
  });

  it("持久化键与文档口径一致（改名会让旧快照读不出开关）", () => {
    expect(BUILTIN_SOURCES_SETTING_KEY).toBe("sources.builtinHidden");
  });
});

describe("目录条目", () => {
  it("展示名与 ui-design §4.3 的四行一致", () => {
    expect(BUILTIN_SOURCES.map((source) => source.name)).toEqual([
      "我的日历",
      "中国节假日",
      "二十四节气",
      "英超赛程",
    ]);
  });

  it("每个来源都有说明，说明里写清关闭后的效果", () => {
    for (const source of BUILTIN_SOURCES) {
      expect(source.description.length).toBeGreaterThan(0);
      expect(source.description).toContain("关闭");
    }
  });
});
