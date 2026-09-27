import type { MarkAssetSource } from "./marks";
import { NO_MARK_ASSETS } from "./marks";

export const MARK_ASSET_FILE = "football-assets.json";
const MAX_PACK_LENGTH = 32 * 1024 * 1024;
const MAX_IMAGE_LENGTH = 1400000;

/** Only local PNG data is accepted: reading a pack never causes a network request. */
export function parseLocalMarkAssets(contents: string | null): MarkAssetSource {
  if (contents === null) return NO_MARK_ASSETS;
  if (contents.length > MAX_PACK_LENGTH) throw new Error("图标资源包过大");
  const pack: unknown = JSON.parse(contents);
  if (!isRecord(pack) || pack.version !== 1 || !Array.isArray(pack.assets)) {
    throw new Error("图标资源包格式不支持");
  }
  if (pack.assets.length > 256) throw new Error("图标资源数量过多");
  const urls = new Map<string, string>();
  for (const asset of pack.assets) {
    if (
      !isRecord(asset) ||
      typeof asset.ref !== "string" ||
      !/^(crest\.team|logo\.competition)\.[a-z0-9-]+$/.test(asset.ref) ||
      typeof asset.dataUrl !== "string" ||
      asset.dataUrl.length > MAX_IMAGE_LENGTH ||
      !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(
        asset.dataUrl,
      ) ||
      urls.has(asset.ref)
    )
      throw new Error("图标资源条目无效或重复");
    urls.set(asset.ref, asset.dataUrl);
  }
  return { urlFor: (ref) => urls.get(ref) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
