import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { EnrichedEvent } from "../data/model";
import { createTauriFileIO } from "../data/store/tauri-file-io";
import { isTauriIpcUnavailable } from "../ipc/tauri-ipc";
import { fixtureAssetRefsAll } from "../semantic/custom-assets";
import {
  MARK_ASSET_FILE,
  parseLocalMarkAssets,
} from "../semantic/local-mark-assets";
import { NO_MARK_ASSETS, type MarkAssetSource } from "../semantic/marks";

interface UserAssetsScan {
  directory: string;
  assets: Record<string, string>;
  rejected: string[];
}

const LOCAL_PNG = /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/;
const LOCAL_REF =
  /^(?:crest\.team|logo\.competition|bg\.(?:festival|solar-term|holiday))\.[a-z0-9-]+$/;

export function useLocalMarkAssets(events: readonly EnrichedEvent[] = []) {
  const [packAssets, setPackAssets] = useState<MarkAssetSource>(NO_MARK_ASSETS);
  const [packStatus, setPackStatus] = useState<string>();
  const [userAssets, setUserAssets] = useState<Record<string, string>>({});
  const [customAssetDirectory, setCustomAssetDirectory] = useState("");
  const [userAssetStatus, setUserAssetStatus] = useState("");
  const scanGeneration = useRef(0);
  const refreshUserAssets = useCallback(async () => {
    if (!isTauri()) return;
    const generation = ++scanGeneration.current;
    try {
      const result = await invoke<UserAssetsScan>("user_assets_scan");
      if (generation !== scanGeneration.current) return;
      const valid = Object.fromEntries(
        Object.entries(result.assets).filter(
          ([ref, url]) => LOCAL_REF.test(ref) && LOCAL_PNG.test(url),
        ),
      );
      setCustomAssetDirectory(result.directory);
      setUserAssets(valid);
      setUserAssetStatus(
        result.rejected.length
          ? `已加载 ${Object.keys(valid).length} 张自定义图片；${result.rejected.length} 个文件未通过检查`
          : `已加载 ${Object.keys(valid).length} 张自定义图片`,
      );
    } catch {
      if (generation === scanGeneration.current)
        setUserAssetStatus("自定义素材读取失败，请检查应用数据目录权限");
    }
  }, []);
  useEffect(() => {
    let disposed = false;
    void createTauriFileIO()
      .readFile(MARK_ASSET_FILE)
      .then((contents) => {
        const source = parseLocalMarkAssets(contents);
        if (!disposed) setPackAssets(source);
      })
      .catch((error: unknown) => {
        if (!disposed && !isTauriIpcUnavailable(error)) {
          setPackStatus("图标资源未能加载，已使用文字显示");
        }
      });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    void refreshUserAssets();
    return () => {
      scanGeneration.current += 1;
    };
  }, [refreshUserAssets]);
  const assets = useMemo<MarkAssetSource>(
    () => ({ urlFor: (ref) => userAssets[ref] ?? packAssets.urlFor(ref) }),
    [userAssets, packAssets],
  );
  const allRefs = useMemo(() => fixtureAssetRefsAll(events), [events]);
  const missingAssetRefs = useMemo(
    () => allRefs.filter((ref) => !assets.urlFor(ref)),
    [allRefs, assets],
  );
  const assetStatus = [packStatus, userAssetStatus].filter(Boolean).join(" · ");
  return {
    assets,
    assetStatus,
    customAssetDirectory,
    missingAssetRefs,
    refreshUserAssets,
  };
}
