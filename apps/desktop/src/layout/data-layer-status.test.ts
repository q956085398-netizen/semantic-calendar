import { describe, expect, it } from "vitest";
import {
  LOADING_ACTION_HINT,
  PREVIEW_IMPORT_HINT,
  PREVIEW_SETTINGS_HINT,
  PREVIEW_SUBSCRIBE_HINT,
  UNAVAILABLE_IMPORT_HINT,
  UNAVAILABLE_SETTINGS_HINT,
  UNAVAILABLE_SUBSCRIBE_HINT,
  dataLayerActionHint,
  dataLayerFailureStatus,
  dataLayerHintOf,
  droppedRecordsNote,
  storeWriteFailureStatus,
} from "./data-layer-status";

describe("数据层提示（SC-019 / §13）", () => {
  it("正常与初始化中不给提示：没有话要说就不说", () => {
    expect(dataLayerHintOf({ kind: "ready" })).toBeUndefined();
    expect(dataLayerHintOf({ kind: "loading" })).toBeUndefined();
  });

  it("预览模式沿用“没有桌面壳”的说法", () => {
    expect(dataLayerHintOf({ kind: "preview" })).toBe(PREVIEW_SETTINGS_HINT);
  });

  it("初始化失败带上原因，与预览模式区分开", () => {
    expect(dataLayerHintOf({ kind: "unavailable", reason: "磁盘只读" })).toBe(
      "本地数据层不可用（磁盘只读）：改动不写入本地设置",
    );
    // 短说法的常量仍在：它是不带原因时的结论句。
    expect(UNAVAILABLE_SETTINGS_HINT).toBe(
      "本地数据层不可用：改动不写入本地设置",
    );
  });

  it("动作提示说明这次动作会不会发生", () => {
    expect(dataLayerActionHint({ kind: "ready" }, "import")).toBeUndefined();
    expect(dataLayerActionHint({ kind: "preview" }, "import")).toBe(
      PREVIEW_IMPORT_HINT,
    );
    expect(dataLayerActionHint({ kind: "preview" }, "subscribe")).toBe(
      PREVIEW_SUBSCRIBE_HINT,
    );
    // 不可用时动作被直接拒绝，因此说的是“无法导入”而不是“没有被保存”。
    expect(
      dataLayerActionHint(
        { kind: "unavailable", reason: "磁盘只读" },
        "import",
      ),
    ).toBe(UNAVAILABLE_IMPORT_HINT);
    expect(
      dataLayerActionHint(
        { kind: "unavailable", reason: "磁盘只读" },
        "subscribe",
      ),
    ).toBe(UNAVAILABLE_SUBSCRIBE_HINT);
    expect(UNAVAILABLE_IMPORT_HINT).not.toContain("不会被保存");
    // 还没就绪既不是预览也不是成功：说“稍后重试”，不冒充其中任何一种。
    expect(dataLayerActionHint({ kind: "loading" }, "import")).toBe(
      LOADING_ACTION_HINT,
    );
  });

  it("初始化失败的状态行同时给出原因与后果", () => {
    const status = dataLayerFailureStatus("Permission denied (os error 13)");

    expect(status).toContain("Permission denied (os error 13)");
    // 日历还能用，导入 / 订阅用不了，设置改动不落盘——三件事都写清。
    expect(status).toContain("日历可浏览");
    expect(status).toContain("导入与订阅不可用");
    expect(status).toContain("设置更改不会保存");
  });

  it("落盘失败的说明区分“界面已生效”与“没写进磁盘”", () => {
    const status = storeWriteFailureStatus("设置", "磁盘已满");

    expect(status).toContain("设置未能写入本地文件：磁盘已满");
    expect(status).toContain("重启后可能丢失");
  });

  it("坏记录提示只说真正发生的部分，没有坏记录时不给提示", () => {
    expect(droppedRecordsNote({ events: 2, sources: 0 })).toBe(
      "已跳过 2 个无法读取的事件",
    );
    expect(droppedRecordsNote({ events: 0, sources: 1 })).toBe(
      "已跳过 1 个无法读取的来源",
    );
    expect(droppedRecordsNote({ events: 1, sources: 3 })).toBe(
      "已跳过 1 个无法读取的事件、3 个无法读取的来源",
    );
    expect(droppedRecordsNote({ events: 0, sources: 0 })).toBeUndefined();
  });
});
