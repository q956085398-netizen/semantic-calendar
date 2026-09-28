import manifest from "../providers/football/asset-manifest.json";
import unknownTeamUrl from "../display/unknown-team.svg";
import type { EnrichedEvent } from "../data/model";
import type { FileIO } from "../data/store/file-io";
import type { MarkAssetSource } from "./marks";
import { displayMetadataOf } from "./metadata-resolver";

export const FOOTBALL_ASSETS_FILE = "football-assets.json";
const knownRefs = new Set(Object.keys(manifest));
export interface AssetDownloadResult {
  assets: Record<string, string>;
  failedRefs: string[];
}
export interface LocalAssetSnapshot {
  source: MarkAssetSource;
  status: string;
}

/** Reject remote URLs, SVGs and unreasonable PNG dimensions at the cache boundary. */
export function isLocalPng(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 1_400_000 ||
    !value.startsWith("data:image/png;base64,")
  )
    return false;
  try {
    const encoded = value.slice(22);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
    const bytes = atob(encoded);
    if (
      bytes.length < 33 ||
      bytes.slice(0, 8) !== "\x89PNG\r\n\x1a\n" ||
      bytes.slice(12, 16) !== "IHDR"
    )
      return false;
    const sizeAt = (offset: number) =>
      ((bytes.charCodeAt(offset) * 256 + bytes.charCodeAt(offset + 1)) * 256 +
        bytes.charCodeAt(offset + 2)) *
        256 +
      bytes.charCodeAt(offset + 3);
    return [sizeAt(16), sizeAt(20)].every((n) => n > 0 && n <= 2048);
  } catch {
    return false;
  }
}

export function fixtureAssetRefs(events: readonly EnrichedEvent[]): string[] {
  const refs = new Set<string>();
  for (const event of events) {
    const fixture = displayMetadataOf(event)?.fixture;
    if (!fixture) continue;
    for (const ref of [
      fixture.competition.logoRef,
      ...fixture.teams.map((t) => t.crestRef),
    ]) {
      if (ref !== undefined && knownRefs.has(ref)) refs.add(ref);
    }
  }
  return [...refs].sort();
}

/** One serialized writer owns a cache. Importing another source cannot overwrite previous badges. */
export function createLocalMarkAssets(
  io: FileIO,
  download: (refs: string[]) => Promise<AssetDownloadResult>,
  publish: (snapshot: LocalAssetSnapshot) => void,
) {
  let data: Record<string, string> = {};
  const attempted = new Set<string>();
  let queue: Promise<void> = Promise.resolve();
  let disposed = false;
  const emit = (status: string) => {
    const current = data;
    if (!disposed)
      publish({
        source: {
          urlFor: (ref) =>
            ref === "crest.team.unknown" ? unknownTeamUrl : current[ref],
        },
        status,
      });
  };
  const loaded = (async () => {
    const raw = await io.readFile(FOOTBALL_ASSETS_FILE);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !("version" in parsed) ||
        parsed.version !== 1 ||
        !("assets" in parsed) ||
        !Array.isArray(parsed.assets)
      )
        throw new Error("图标缓存格式不正确");
      for (const entry of parsed.assets) {
        if (
          entry &&
          typeof entry === "object" &&
          typeof entry.ref === "string" &&
          knownRefs.has(entry.ref) &&
          isLocalPng(entry.dataUrl)
        )
          data[entry.ref] = entry.dataUrl;
      }
    }
    emit(`本地赛事图标 ${Object.keys(data).length} 个`);
  })();
  // Register a handler immediately: loading may finish before the first event batch.
  void loaded.catch(() => emit("图标缓存读取失败，已保留原文件并使用替代标记"));
  return {
    dispose() {
      disposed = true;
    },
    sync(refs: readonly string[]): Promise<void> {
      queue = queue
        .then(async () => {
          try {
            await loaded;
          } catch {
            return;
          }
          if (disposed) return;
          const missing = [...new Set(refs)].filter(
            (ref) => knownRefs.has(ref) && !data[ref] && !attempted.has(ref),
          );
          if (missing.length === 0) return;
          missing.forEach((ref) => attempted.add(ref));
          emit(`正在下载 ${missing.length} 个赛事图标…`);
          const result = await download(missing);
          if (disposed) return;
          const accepted: Record<string, string> = {};
          for (const ref of missing)
            if (isLocalPng(result?.assets?.[ref]))
              accepted[ref] = result.assets[ref];
          data = { ...data, ...accepted };
          const failed = missing.length - Object.keys(accepted).length;
          emit(
            failed
              ? `${failed} 个图标暂未获取，使用替代标记；下次启动会重试`
              : `本地赛事图标 ${Object.keys(data).length} 个`,
          );
          if (Object.keys(accepted).length > 0) {
            await io.writeFile(
              `${FOOTBALL_ASSETS_FILE}.tmp`,
              JSON.stringify({
                version: 1,
                assets: Object.entries(data).map(([ref, dataUrl]) => ({
                  ref,
                  dataUrl,
                })),
              }),
            );
            await io.renameFile(
              `${FOOTBALL_ASSETS_FILE}.tmp`,
              FOOTBALL_ASSETS_FILE,
            );
          }
        })
        .catch(() => emit("图标下载或保存失败，已有图片仍可显示；下次启动会重试"));
      return queue;
    },
  };
}

/** Web preview has no native cache; its bundled unknown-team badge still works. */
export const DEFAULT_MARK_ASSETS: MarkAssetSource = {
  urlFor: (ref) => (ref === "crest.team.unknown" ? unknownTeamUrl : undefined),
};
