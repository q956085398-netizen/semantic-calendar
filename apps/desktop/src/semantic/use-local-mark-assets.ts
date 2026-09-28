import { useEffect, useMemo, useRef, useState } from "react";
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

export function useLocalMarkAssets(events: readonly EnrichedEvent[]) {
  const [snapshot, setSnapshot] = useState<LocalAssetSnapshot>({
    source: DEFAULT_MARK_ASSETS,
    status: "",
  });
  const cacheRef = useRef<ReturnType<typeof createLocalMarkAssets> | null>(
    null,
  );
  const refs = useMemo(() => fixtureAssetRefs(events), [events]);
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
  return snapshot;
}
