import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { EnrichedEvent } from "../data/model";
import { createTauriFileIO } from "../data/store/tauri-file-io";
import {
  createLocalMarkAssets,
  DEFAULT_MARK_ASSETS,
  fixtureAssetRefs,
  type AssetDownloadResult,
  type LocalAssetSnapshot,
} from "./local-mark-assets";
import { isLocalPng } from "./local-mark-assets";
import { fixtureAssetRefsAll } from "./custom-assets";

interface UserAssetsScan {
  directory: string;
  assets: Record<string, string>;
  rejected: string[];
}

export function useLocalMarkAssets(events: readonly EnrichedEvent[]) {
  const [snapshot, setSnapshot] = useState<LocalAssetSnapshot>({
    source: DEFAULT_MARK_ASSETS,
    status: "",
  });
  const cacheRef = useRef<ReturnType<typeof createLocalMarkAssets> | null>(
    null,
  );
  const [userAssets, setUserAssets] = useState<Record<string, string>>({});
  const [userDirectory, setUserDirectory] = useState("");
  const [userAssetStatus, setUserAssetStatus] = useState("");
  const refs = useMemo(() => fixtureAssetRefs(events), [events]);
  const allRefs = useMemo(() => fixtureAssetRefsAll(events), [events]);
  const refreshUserAssets = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const result = await invoke<UserAssetsScan>("user_assets_scan");
      setUserDirectory(result.directory);
      setUserAssets(
        Object.fromEntries(
          Object.entries(result.assets).filter(([, value]) =>
            isLocalPng(value),
          ),
        ),
      );
      setUserAssetStatus(
        result.rejected.length
          ? `已加载 ${Object.keys(result.assets).length} 张自定义图片；${result.rejected.length} 个文件未通过检查`
          : `已加载 ${Object.keys(result.assets).length} 张自定义图片`,
      );
    } catch {
      setUserAssetStatus("自定义素材读取失败，请检查应用数据目录权限");
    }
  }, []);
  useEffect(() => {
    void refreshUserAssets();
  }, [refreshUserAssets]);
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    const cache = createLocalMarkAssets(
      createTauriFileIO(),
      (refs) =>
        invoke<AssetDownloadResult>("football_assets_download", { refs }),
      (state) => {
        if (active) setSnapshot(state);
      },
    );
    cacheRef.current = cache;
    return () => {
      active = false;
      cache.dispose();
      cacheRef.current = null;
    };
  }, []);
  useEffect(() => {
    void cacheRef.current?.sync(refs);
  }, [refs]);
  const source = useMemo(
    () => ({
      urlFor: (ref: string) => userAssets[ref] ?? snapshot.source.urlFor(ref),
    }),
    [userAssets, snapshot.source],
  );
  const missingRefs = useMemo(
    () => allRefs.filter((ref) => !source.urlFor(ref)),
    [allRefs, source],
  );
  return {
    source,
    status: [snapshot.status, userAssetStatus].filter(Boolean).join(" · "),
    directory: userDirectory,
    missingRefs,
    refreshUserAssets,
  };
}
