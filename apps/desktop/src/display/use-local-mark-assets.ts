import { useEffect, useState } from "react";
import { createTauriFileIO } from "../data/store/tauri-file-io";
import { isTauriIpcUnavailable } from "../ipc/tauri-ipc";
import {
  MARK_ASSET_FILE,
  parseLocalMarkAssets,
} from "../semantic/local-mark-assets";
import { NO_MARK_ASSETS, type MarkAssetSource } from "../semantic/marks";

export function useLocalMarkAssets() {
  const [assets, setAssets] = useState<MarkAssetSource>(NO_MARK_ASSETS);
  const [assetStatus, setAssetStatus] = useState<string>();
  useEffect(() => {
    let disposed = false;
    void createTauriFileIO()
      .readFile(MARK_ASSET_FILE)
      .then((contents) => {
        const source = parseLocalMarkAssets(contents);
        if (!disposed) setAssets(source);
      })
      .catch((error: unknown) => {
        if (!disposed && !isTauriIpcUnavailable(error)) {
          setAssetStatus("图标资源未能加载，已使用文字显示");
        }
      });
    return () => {
      disposed = true;
    };
  }, []);
  return { assets, assetStatus };
}
