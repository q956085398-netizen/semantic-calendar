import { describe, expect, it, vi } from "vitest";
import {
  createLocalMarkAssets,
  FOOTBALL_ASSETS_FILE,
  isLocalPng,
  type LocalAssetSnapshot,
  type AssetDownloadResult,
} from "./local-mark-assets";
import type { FileIO } from "../data/store/file-io";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==";
const ref = "crest.team.arsenal",
  other = "crest.team.psv";
function harness(raw: string | null = null) {
  const files = new Map<string, string>(
    raw === null ? [] : [[FOOTBALL_ASSETS_FILE, raw]],
  );
  const io: FileIO = {
    readFile: vi.fn(async (name) => files.get(name) ?? null),
    writeFile: vi.fn(async (name, contents) => {
      files.set(name, contents);
    }),
    renameFile: vi.fn(async (from, to) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    }),
  };
  const snapshots: LocalAssetSnapshot[] = [];
  const download = vi.fn(
    async (refs: string[]): Promise<AssetDownloadResult> => ({
      assets: Object.fromEntries(refs.map((r) => [r, png])),
      failedRefs: [],
    }),
  );
  return {
    files,
    io,
    snapshots,
    download,
    cache: createLocalMarkAssets(io, download, (s) => snapshots.push(s)),
  };
}
const pack = (assets: unknown[]) => JSON.stringify({ version: 1, assets });
describe("本地足球图片缓存", () => {
  it("复用旧版资源包，离线读取不下载；通用未知队徽始终可用", async () => {
    const h = harness(pack([{ ref, dataUrl: png }]));
    await h.cache.sync([ref]);
    expect(h.download).not.toHaveBeenCalled();
    expect(h.snapshots.at(-1)?.source.urlFor(ref)).toBe(png);
    expect(
      h.snapshots.at(-1)?.source.urlFor("crest.team.unknown"),
    ).toBeTruthy();
  });
  it("并行导入串行合并缓存；去重且只下载已登记逻辑引用", async () => {
    const h = harness();
    await Promise.all([
      h.cache.sync([ref, ref, "https://private.example/secret"]),
      h.cache.sync([ref, other]),
    ]);
    expect(h.download.mock.calls.map((c) => c[0])).toEqual([[ref], [other]]);
    expect(JSON.parse(h.files.get(FOOTBALL_ASSETS_FILE)!).assets).toHaveLength(
      2,
    );
    expect(h.io.renameFile).toHaveBeenCalledWith(
      FOOTBALL_ASSETS_FILE + ".tmp",
      FOOTBALL_ASSETS_FILE,
    );
  });
  it("缓存里的远程地址或损坏图片被忽略，然后补下载", async () => {
    const h = harness(
      pack([
        { ref, dataUrl: "https://example.com/a.png" },
        { ref: other, dataUrl: "data:image/png;base64,bad" },
      ]),
    );
    await h.cache.sync([ref, other]);
    expect(h.download).toHaveBeenCalledWith([ref, other]);
  });
  it("下载失败不影响已有图片，也不会反复发送请求", async () => {
    const h = harness(pack([{ ref, dataUrl: png }]));
    h.download.mockResolvedValue({ assets: {}, failedRefs: [other] });
    await h.cache.sync([ref, other]);
    await h.cache.sync([other]);
    expect(h.snapshots.at(-1)?.source.urlFor(ref)).toBe(png);
    expect(h.snapshots.at(-1)?.source.urlFor(other)).toBeUndefined();
    expect(h.snapshots.at(-1)?.status).toContain("暂未获取");
    expect(h.download).toHaveBeenCalledTimes(1);
    expect(h.io.writeFile).not.toHaveBeenCalled();
  });
  it("保存失败仍可显示本次下载结果并给出状态", async () => {
    const h = harness();
    h.io.writeFile = vi.fn(async () => {
      throw new Error("disk");
    });
    await h.cache.sync([ref]);
    expect(h.snapshots.at(-1)?.source.urlFor(ref)).toBe(png);
    expect(h.snapshots.at(-1)?.status).toContain("保存失败");
  });
  it("格式错误的整份缓存保留原文件，避免覆盖用户资源", async () => {
    const h = harness("{broken");
    await h.cache.sync([ref]);
    expect(h.files.get(FOOTBALL_ASSETS_FILE)).toBe("{broken");
    expect(h.download).not.toHaveBeenCalled();
    expect(h.io.writeFile).not.toHaveBeenCalled();
  });
  it("释放后不下载或发布资源", async () => {
    const h = harness();
    h.cache.dispose();
    await h.cache.sync([ref]);
    expect(h.snapshots).toEqual([]);
    expect(h.download).not.toHaveBeenCalled();
  });
  it("资源边界拒绝非 PNG / 空图 / 超限内容", () => {
    expect(isLocalPng(png)).toBe(true);
    for (const invalid of [
      null,
      "data:image/svg+xml,<svg/>",
      "data:image/png;base64,",
      png + "!",
      png + "a".repeat(1_400_000),
    ])
      expect(isLocalPng(invalid)).toBe(false);
  });
});
