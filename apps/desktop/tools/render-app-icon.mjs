// 生成应用图标源图（src-tauri/app-icon.png 与 app-icon.svg）。
//
// 为什么图标是画出来的而不是放进仓库的一张图片：仓库不分发来源不明的图片资源
// （开发原则 §10 / app-spec §18），应用图标必须能说清来源与许可。这里的设计稿
// 是纯几何形状（圆角矩形）加项目调色板，由本脚本确定性生成 PNG 与 SVG，因此
// 图标本身就是本仓库的原创资产，与代码同一份 License（见 LICENSE）。
//
// 形状：一页日历 —— 深色页眉 + 六格月历，其中一格用语义 accent 点亮，
// 即「一个月里被识别出含义的那一天」。几何量以 1024 画布为单位。
//
// 用法：
//   node tools/render-app-icon.mjs                  # 写 src-tauri/app-icon.png 与 app-icon.svg
//   node tools/render-app-icon.mjs --preview p.png  # 额外输出小尺寸对照图，人工检查 16–128px
// 派生各平台图标（Windows .ico / 托盘 / MSIX 方块图）：
//   npm run icon
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CANVAS = 1024;

// 项目调色板（与 src/index.css 的浅色主题同源）
const PAPER = "#f6f3ec"; // 页眉之下的纸面
const INK = "#27313a"; // --text-primary，页眉与深色文字
const CELL = "#c7c3ba"; // 未点亮的格子：INK 混进 PAPER 的低浓度结果
const ACCENT = "#d95f44"; // --accent，被识别出的那一天

// 几何：页眉 0–300，六格 3×2 居中排在页眉之下
const TILE_RADIUS = 224;
const BAND_HEIGHT = 300;
const CELL_SIZE = 200;
const CELL_GAP = 52;
const CELL_RADIUS = 52;

const CELL_COLORS = [
  CELL,
  CELL,
  CELL,
  CELL,
  CELL,
  ACCENT, // 阅读顺序的最后一格
];

function iconShapes() {
  const shapes = [
    // 整块纸面：满画布圆角方形，四角透明
    {
      rect: [0, 0, CANVAS, CANVAS],
      radius: TILE_RADIUS,
      fill: PAPER,
    },
    // 页眉：只有上面两角随纸面圆角
    {
      rect: [0, 0, CANVAS, BAND_HEIGHT],
      radius: TILE_RADIUS,
      corners: { tl: true, tr: true, br: false, bl: false },
      fill: INK,
    },
  ];

  const gridWidth = 3 * CELL_SIZE + 2 * CELL_GAP;
  const gridHeight = 2 * CELL_SIZE + CELL_GAP;
  const left = (CANVAS - gridWidth) / 2;
  const top = BAND_HEIGHT + (CANVAS - BAND_HEIGHT - gridHeight) / 2;

  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const x = left + column * (CELL_SIZE + CELL_GAP);
      const y = top + row * (CELL_SIZE + CELL_GAP);
      shapes.push({
        rect: [x, y, x + CELL_SIZE, y + CELL_SIZE],
        radius: CELL_RADIUS,
        fill: CELL_COLORS[row * 3 + column],
      });
    }
  }

  return shapes;
}

// —— 光栅化 ——
// 只支持圆角矩形，采样 4×4 超采样换取边缘抗锯齿；颜色按预乘 alpha 叠加。

const SUPERSAMPLE = 4;

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
  ];
}

function createCanvas(width, height) {
  return { width, height, data: new Float32Array(width * height * 4) };
}

function fillCanvas(canvas, hex) {
  const [r, g, b] = hexToRgb(hex);
  for (let i = 0; i < canvas.width * canvas.height; i += 1) {
    canvas.data[i * 4] = r;
    canvas.data[i * 4 + 1] = g;
    canvas.data[i * 4 + 2] = b;
    canvas.data[i * 4 + 3] = 1;
  }
}

/** 采样点是否落在圆角矩形内（坐标是图标空间 0–1024）。 */
function insideShape(shape, x, y) {
  const [x0, y0, x1, y1] = shape.rect;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;

  const corners = shape.corners ?? { tl: true, tr: true, br: true, bl: true };
  const r = shape.radius;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : null;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : null;

  // 不在任何圆角区域：矩形内部
  if (cx === null || cy === null) return true;

  const isLeft = cx === x0 + r;
  const isTop = cy === y0 + r;
  const rounded = isTop
    ? isLeft
      ? corners.tl
      : corners.tr
    : isLeft
      ? corners.bl
      : corners.br;
  if (!rounded) return true;

  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * 把一个图标形状画进画布。scale 是「图标空间 → 画布」的缩放，
 * dx / dy 是画布上的落点，因此同一套形状既能出整图也能出对照图里的小尺寸。
 */
function drawShape(canvas, shape, { scale, dx, dy }) {
  const [r, g, b] = hexToRgb(shape.fill);
  const [x0, y0, x1, y1] = shape.rect.map((v) => v * scale);
  const left = Math.max(0, Math.floor(dx + x0));
  const top = Math.max(0, Math.floor(dy + y0));
  const right = Math.min(canvas.width, Math.ceil(dx + x1));
  const bottom = Math.min(canvas.height, Math.ceil(dy + y1));
  const step = 1 / SUPERSAMPLE;
  const total = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const ix = (px + (sx + 0.5) * step - dx) / scale;
          const iy = (py + (sy + 0.5) * step - dy) / scale;
          if (insideShape(shape, ix, iy)) hits += 1;
        }
      }
      if (hits === 0) continue;

      const a = hits / total;
      const index = (py * canvas.width + px) * 4;
      const dstA = canvas.data[index + 3];
      const outA = a + dstA * (1 - a);
      // 目标色是预乘值，源色不透明，因此乘上覆盖率再与目标混合
      canvas.data[index] = r * a + canvas.data[index] * (1 - a);
      canvas.data[index + 1] = g * a + canvas.data[index + 1] * (1 - a);
      canvas.data[index + 2] = b * a + canvas.data[index + 2] * (1 - a);
      canvas.data[index + 3] = outA;
    }
  }
}

function renderIcon(size, { dx = 0, dy = 0 } = {}) {
  const canvas = createCanvas(size, size);
  const scale = size / CANVAS;
  for (const shape of iconShapes()) drawShape(canvas, shape, { scale, dx, dy });
  return canvas;
}

/** 把 src 叠到 dst 的 (dx, dy) 处（源是预乘 alpha，直接相加）。 */
function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const from = (y * src.width + x) * 4;
      const to = ((dy + y) * dst.width + dx + x) * 4;
      const alpha = src.data[from + 3];
      for (let channel = 0; channel < 3; channel += 1) {
        dst.data[to + channel] =
          src.data[from + channel] + dst.data[to + channel] * (1 - alpha);
      }
      dst.data[to + 3] = alpha + dst.data[to + 3] * (1 - alpha);
    }
  }
}

// —— PNG 编码 ——

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(canvas) {
  const { width, height } = canvas;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = canvas.data[index + 3];
      const offset = rowStart + 1 + x * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const premultiplied = canvas.data[index + channel];
        const straight = alpha > 0 ? premultiplied / alpha : 0;
        raw[offset + channel] = Math.max(
          0,
          Math.min(255, Math.round(straight * 255)),
        );
      }
      raw[offset + 3] = Math.max(0, Math.min(255, Math.round(alpha * 255)));
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// —— SVG 输出（设计稿的可读版本，与 PNG 同一套几何量）——

function shapePath({ rect, radius, corners }) {
  const [x0, y0, x1, y1] = rect;
  const c = corners ?? { tl: true, tr: true, br: true, bl: true };
  const r = {
    tl: c.tl ? radius : 0,
    tr: c.tr ? radius : 0,
    br: c.br ? radius : 0,
    bl: c.bl ? radius : 0,
  };

  const parts = [`M ${x0 + r.tl} ${y0}`];
  parts.push(
    `H ${x1 - r.tr}`,
    r.tr ? `A ${r.tr} ${r.tr} 0 0 1 ${x1} ${y0 + r.tr}` : `V ${y0}`,
  );
  parts.push(
    `V ${y1 - r.br}`,
    r.br ? `A ${r.br} ${r.br} 0 0 1 ${x1 - r.br} ${y1}` : `H ${x1}`,
  );
  parts.push(
    `H ${x0 + r.bl}`,
    r.bl ? `A ${r.bl} ${r.bl} 0 0 1 ${x0} ${y1 - r.bl}` : `V ${y1}`,
  );
  parts.push(
    `V ${y0 + r.tl}`,
    r.tl ? `A ${r.tl} ${r.tl} 0 0 1 ${x0 + r.tl} ${y0}` : `H ${x0}`,
  );
  parts.push("Z");
  return parts.join(" ");
}

function renderSvg() {
  const body = iconShapes()
    .map((shape) => `  <path d="${shapePath(shape)}" fill="${shape.fill}" />`)
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}">
  <title>语义日历 / Semantic Calendar</title>
${body}
</svg>
`;
}

// —— 小尺寸对照图（人工检查，不随仓库分发）——

const PREVIEW_SIZES = [16, 24, 32, 48, 64, 128];
const PREVIEW_BACKGROUNDS = ["#f4f1ea", "#1f2429"]; // 浅色 / 深色任务栏

function renderPreview() {
  const padding = 24;
  const gap = 16;
  const rowHeight = Math.max(...PREVIEW_SIZES) + padding * 2;
  const width =
    PREVIEW_SIZES.reduce((sum, size) => sum + size, 0) +
    gap * (PREVIEW_SIZES.length + 1);
  const canvas = createCanvas(width, rowHeight * PREVIEW_BACKGROUNDS.length);

  PREVIEW_BACKGROUNDS.forEach((background, row) => {
    const top = row * rowHeight;
    const strip = createCanvas(width, rowHeight);
    fillCanvas(strip, background);
    blit(canvas, strip, 0, top);
    let x = gap;
    for (const size of PREVIEW_SIZES) {
      const icon = renderIcon(size);
      blit(canvas, icon, x, top + Math.round((rowHeight - size) / 2));
      x += size + gap;
    }
  });

  return canvas;
}

// —— 入口 ——

const here = path.dirname(fileURLToPath(import.meta.url));
const pngPath = path.join(here, "..", "src-tauri", "app-icon.png");
const svgPath = path.join(here, "..", "src-tauri", "app-icon.svg");
const previewIndex = process.argv.indexOf("--preview");
const previewPath = previewIndex === -1 ? null : process.argv[previewIndex + 1];

writeFileSync(pngPath, encodePng(renderIcon(CANVAS)));
writeFileSync(svgPath, renderSvg());
console.log(`已写入 ${pngPath}`);
console.log(`已写入 ${svgPath}`);

if (previewPath) {
  writeFileSync(previewPath, encodePng(renderPreview()));
  console.log(`已写入 ${previewPath}（16–128px 对照图，浅色 / 深色两行）`);
}
