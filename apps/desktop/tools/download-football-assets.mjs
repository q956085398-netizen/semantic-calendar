// Explicit local validation download; no API credentials or automatic network access.
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

const outputIndex = process.argv.indexOf("--output");
if (outputIndex < 0 || !process.argv[outputIndex + 1]) {
  throw new Error(
    "Usage: node tools/download-football-assets.mjs --output <football-assets.json>",
  );
}
const output = resolve(process.argv[outputIndex + 1]);
const catalog = JSON.parse(
  await readFile(
    new URL("./premier-league-assets.json", import.meta.url),
    "utf8",
  ),
);
const entries = Object.entries(catalog.teams).map(([id, name]) => ({
  ref: `crest.team.${id}`,
  sourceId: `${catalog.repository}@${catalog.revision}:${catalog.directory}/${name}.png`,
  sourceUrl: `https://raw.githubusercontent.com/${catalog.repository}/${catalog.revision}/${[...catalog.directory.split("/"), `${name}.png`].map(encodeURIComponent).join("/")}`,
}));
entries.push({
  ref: catalog.competition.ref,
  sourceId: catalog.competition.sourceId,
  sourceUrl: catalog.competition.url,
});

const assets = [];
for (const entry of entries) {
  const bytes = await download(entry);
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    throw new Error(`${entry.ref}: invalid PNG signature`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096)
    throw new Error(`${entry.ref}: invalid dimensions`);
  assets.push({
    ...entry,
    width,
    height,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
  });
  console.log(`${entry.ref}: ${width}x${height}, ${bytes.length} bytes`);
}
// Publish only after every download passed; failure preserves the previous pack.
const pack = {
  version: 1,
  season: catalog.season,
  downloadedAt: new Date().toISOString(),
  usage: "local-validation; image redistribution rights unverified",
  assets,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(`${output}.tmp`, JSON.stringify(pack), "utf8");
await rename(`${output}.tmp`, output);
console.log(`Saved ${assets.length} images to ${output}`);

async function download(entry) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(entry.sourceUrl, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type")?.split(";")[0];
      if (contentType !== "image/png")
        throw new Error(`not PNG (${contentType})`);
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 1024 * 1024) throw new Error("image exceeds 1 MiB");
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (attempt === 3)
        throw new Error(`${entry.ref}: ${error.message}`, { cause: error });
      console.log(`${entry.ref}: retry ${attempt}/2`);
    }
  }
}
