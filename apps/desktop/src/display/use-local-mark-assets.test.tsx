import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocalMarkAssets } from "./use-local-mark-assets";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => false }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5E0AAAAASUVORK5CYII=";
describe("桌面图标资源加载", () => {
  it("从独立资源文件读取，异步加载后发布给 UI", async () => {
    invoke.mockResolvedValue(
      JSON.stringify({
        version: 1,
        assets: [{ ref: "crest.team.arsenal", dataUrl: png }],
      }),
    );
    const { result } = renderHook(useLocalMarkAssets);
    await waitFor(() =>
      expect(result.current.assets.urlFor("crest.team.arsenal")).toBe(png),
    );
    expect(invoke).toHaveBeenCalledWith("data_store_read", {
      fileName: "football-assets.json",
    });
    expect(result.current.assetStatus).toBe("");
  });
  it("损坏文件不阻断日历，显示可解释的文字回退状态", async () => {
    invoke.mockResolvedValue("broken json");
    const { result } = renderHook(useLocalMarkAssets);
    await waitFor(() =>
      expect(result.current.assetStatus).toContain("已使用文字显示"),
    );
    expect(result.current.assets.urlFor("crest.team.arsenal")).toBeUndefined();
  });
});
