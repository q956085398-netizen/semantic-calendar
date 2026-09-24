import { describe, expect, it, vi } from "vitest";
import type { NormalizedEvent, SemanticEvent } from "../data/model";
import {
  createBuiltinTypeMetadataResolver,
  createMetadataResolver,
  displayMetadataOf,
  type MetadataResolver,
} from "./metadata-resolver";

function semantic(type: SemanticEvent["type"]): SemanticEvent {
  return { type, matcherId: "test-matcher" };
}

const EVENT: NormalizedEvent = {
  uid: "uid-1",
  sourceId: "src",
  title: "任意标题",
  normalizedTitle: "任意标题",
  start: "2026-10-01",
  allDay: true,
};

describe("内置类型级 Resolver（app-spec §7.5）", () => {
  const resolver = createBuiltinTypeMetadataResolver();

  it("节假日：语义色 + 本地化标签 + 当天早晨提醒", () => {
    expect(resolver.resolve(semantic("holiday"), EVENT)).toEqual({
      accent: "var(--semantic-holiday)",
      label: "法定节假日",
      reminder: { kind: "same-morning" },
    });
  });

  it("补班 / 传统节日 / 节气：各自的语义色与默认提醒", () => {
    expect(resolver.resolve(semantic("makeup-workday"), EVENT)).toMatchObject({
      accent: "var(--semantic-makeup-workday)",
      label: "补班日",
      reminder: { kind: "same-morning" },
    });
    expect(resolver.resolve(semantic("festival"), EVENT)).toMatchObject({
      label: "传统节日",
      reminder: { kind: "previous-evening" },
    });
    expect(resolver.resolve(semantic("solar-term"), EVENT)).toMatchObject({
      label: "节气",
      reminder: { kind: "same-morning" },
    });
  });

  it("比赛：提前 30 分钟提醒（架构文档 §7 默认策略）", () => {
    expect(resolver.resolve(semantic("sport.fixture"), EVENT)).toMatchObject({
      accent: "var(--semantic-sport)",
      label: "体育赛事",
      reminder: { kind: "minutes-before-start", minutes: 30 },
    });
  });

  it("普通事件与未知类型不产生元数据（回退普通显示）", () => {
    expect(resolver.resolve(semantic("calendar.event"), EVENT)).toBeNull();
  });
});

describe("组合 Resolver：Metadata 可独立替换", () => {
  function teamResolver(id: string, accent: string): MetadataResolver {
    return {
      id,
      resolve: (info) =>
        info.type === "sport.fixture" ? { accent, label: id } : null,
    };
  }

  it("按注册顺序取第一个非 null 结果，顺序确定", () => {
    const composite = createMetadataResolver([
      teamResolver("custom-pack", "var(--custom)"),
      createBuiltinTypeMetadataResolver(),
    ]);
    expect(composite.resolve(semantic("sport.fixture"), EVENT)?.accent).toBe(
      "var(--custom)",
    );
    // 组合器未命中的类型继续交给后续 Resolver。
    expect(composite.resolve(semantic("holiday"), EVENT)?.label).toBe(
      "法定节假日",
    );
  });

  it("替换 Resolver 集合即可换元数据来源，无需动 Matcher / UI", () => {
    const before = createMetadataResolver([teamResolver("a", "var(--a)")]);
    const after = createMetadataResolver([teamResolver("b", "var(--b)")]);
    expect(before.resolve(semantic("sport.fixture"), EVENT)?.accent).toBe(
      "var(--a)",
    );
    expect(after.resolve(semantic("sport.fixture"), EVENT)?.accent).toBe(
      "var(--b)",
    );
  });

  it("全部未命中返回 null；空集合同样返回 null", () => {
    expect(
      createMetadataResolver([]).resolve(semantic("holiday"), EVENT),
    ).toBeNull();
    const onlySport = createMetadataResolver([teamResolver("x", "var(--x)")]);
    expect(onlySport.resolve(semantic("festival"), EVENT)).toBeNull();
  });

  it("抛错的 Resolver 被隔离，后续 Resolver 接管", () => {
    const onResolverError = vi.fn();
    const exploding: MetadataResolver = {
      id: "exploding",
      resolve: () => {
        throw new Error("resolver 内部错误");
      },
    };
    const fallback = teamResolver("fallback", "var(--fallback)");
    const composite = createMetadataResolver([exploding, fallback], {
      onResolverError,
    });

    expect(composite.resolve(semantic("sport.fixture"), EVENT)?.accent).toBe(
      "var(--fallback)",
    );
    expect(onResolverError).toHaveBeenCalledWith(
      expect.objectContaining({ resolverId: "exploding" }),
    );
  });
});

describe("displayMetadataOf：读取边界防御性收窄", () => {
  it("合法元数据按契约返回", () => {
    expect(
      displayMetadataOf({
        metadata: {
          accent: "var(--semantic-sport)",
          label: "英超",
          reminder: { kind: "minutes-before-start", minutes: 30 },
        },
      }),
    ).toEqual({
      accent: "var(--semantic-sport)",
      label: "英超",
      reminder: { kind: "minutes-before-start", minutes: 30 },
    });
  });

  it("磁盘上的畸形字段被丢弃而不是炸掉 UI", () => {
    expect(
      displayMetadataOf({ metadata: { accent: 123, label: "英超" } }),
    ).toEqual({ label: "英超" });
    expect(
      displayMetadataOf({
        metadata: { reminder: { kind: "bogus" } },
      }),
    ).toEqual({});
  });

  it("无元数据或非对象元数据返回 undefined", () => {
    expect(displayMetadataOf({})).toBeUndefined();
    expect(displayMetadataOf({ metadata: "noise" })).toBeUndefined();
  });
});
