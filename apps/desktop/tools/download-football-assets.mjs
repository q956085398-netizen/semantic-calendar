import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const outputFlag = process.argv.indexOf("--output");
if (outputFlag < 0 || !process.argv[outputFlag + 1]) {
  console.error(
    "Usage: node tools/download-football-assets.mjs --output <football-assets.json>",
  );
  process.exit(2);
}
const output = resolve(process.argv[outputFlag + 1]);
const manifest = JSON.parse(
  await readFile(
    fileURLToPath(
      new URL("../src/providers/football/asset-manifest.json", import.meta.url),
    ),
    "utf8",
  ),
);
let old = [];
try {
  const pack = JSON.parse(await readFile(output, "utf8"));
  if (pack.version !== 1 || !Array.isArray(pack.assets))
    throw new Error("Invalid existing asset pack; refusing to overwrite");
  old = pack.assets;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const assets = new Map(
  old
    .filter((a) => Object.hasOwn(manifest, a.ref) && isPng(a.dataUrl))
    .map((a) => [a.ref, a]),
);
const pending = Object.entries(manifest).filter(([ref]) => !assets.has(ref));
const failed = [];
for (let offset = 0; offset < pending.length; offset += 4) {
  await Promise.all(
    pending.slice(offset, offset + 4).map(async ([ref, sourceUrl]) => {
      try {
        const response = await fetch(sourceUrl, {
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
        if (!isPng(dataUrl)) throw new Error("Invalid PNG");
        assets.set(ref, {
          ref,
          sourceUrl,
          dataUrl,
          width: bytes.readUInt32BE(16),
          height: bytes.readUInt32BE(20),
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
        console.log(`Downloaded ${ref}`);
      } catch (error) {
        failed.push(ref);
        console.error(`Failed ${ref}: ${error.message}`);
      }
    }),
  );
}
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output + ".tmp",
  JSON.stringify({
    version: 1,
    downloadedAt: new Date().toISOString(),
    usage: "local cache; image rights remain with their owners",
    assets: [...assets.values()].sort((a, b) => a.ref.localeCompare(b.ref)),
  }),
);
await rename(output + ".tmp", output);
console.log(JSON.stringify({ cached: assets.size, failed, output }));
if (failed.length) process.exitCode = 1;

function isPng(value) {
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,"))
    return false;
  const bytes = Buffer.from(value.slice(22), "base64");
  return (
    bytes.length >= 33 &&
    bytes.length <= 1024 * 1024 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR" &&
    [bytes.readUInt32BE(16), bytes.readUInt32BE(20)].every(
      (n) => n > 0 && n <= 2048,
    )
  );
}
