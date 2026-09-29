/**
 * Generate transparent bomb→blast sprite sheet (no deps beyond node zlib).
 * Output: apps/desktop/public/effects/bomb-boom.png
 * Layout: 8 frames × 32×32, horizontal strip.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(
  __dirname,
  "../apps/desktop/public/effects/bomb-boom.png",
);

const FW = 32;
const FH = 32;
const FRAMES = 8;

const C = {
  clear: [0, 0, 0, 0],
  black: [17, 17, 17, 255],
  white: [255, 255, 255, 255],
  fuse: [196, 165, 116, 255],
  sparkY: [255, 225, 77, 255],
  sparkO: [255, 138, 43, 255],
  sparkR: [255, 59, 31, 255],
  blastR: [139, 26, 18, 255],
  blastO: [232, 90, 24, 255],
  blastY: [255, 197, 61, 255],
  blastC: [255, 243, 168, 255],
};

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC_TABLE = crcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crcData = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = rowStart + 1 + x * 4;
      raw[di] = rgba[si];
      raw[di + 1] = rgba[si + 1];
      raw[di + 2] = rgba[si + 2];
      raw[di + 3] = rgba[si + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeFrame() {
  return new Uint8ClampedArray(FW * FH * 4);
}

function setPx(frame, x, y, color) {
  if (x < 0 || y < 0 || x >= FW || y >= FH) return;
  const i = (y * FW + x) * 4;
  frame[i] = color[0];
  frame[i + 1] = color[1];
  frame[i + 2] = color[2];
  frame[i + 3] = color[3];
}

function fillRect(frame, x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) setPx(frame, xx, yy, color);
}

function drawBomb(frame, ox = 8, oy = 8, crack = false, scale = 1) {
  // simple 16x16 bomb centered with offset; scale 1 only for pixel grid
  const px = (x, y, c) => setPx(frame, ox + x, oy + y, c);
  // fuse
  px(7, 1, C.black);
  px(8, 0, C.black);
  px(9, 0, C.black);
  px(10, 0, C.sparkY);
  px(11, 0, C.sparkO);
  px(10, 1, C.sparkR);
  // neck
  fillRect(frame, ox + 7, oy + 2, 2, 2, C.black);
  // body
  fillRect(frame, ox + 4, oy + 4, 8, 1, C.black);
  fillRect(frame, ox + 3, oy + 5, 10, 1, C.black);
  fillRect(frame, ox + 2, oy + 6, 12, 5, C.black);
  fillRect(frame, ox + 3, oy + 11, 10, 1, C.black);
  fillRect(frame, ox + 4, oy + 12, 8, 1, C.black);
  fillRect(frame, ox + 5, oy + 13, 6, 1, C.black);
  // gloss
  fillRect(frame, ox + 10, oy + 6, 1, 3, C.white);
  fillRect(frame, ox + 11, oy + 7, 1, 2, C.white);
  setPx(frame, ox + 4, oy + 10, C.white);
  if (crack) {
    fillRect(frame, ox + 7, oy + 5, 1, 6, C.sparkY);
    fillRect(frame, ox + 5, oy + 8, 5, 1, C.sparkO);
  }
}

function drawBlast(frame, t) {
  // t: 0 small … 1 full … >1 fading (we pass size + fade via params)
  // body silhouette lobes
  const cx = 16;
  const cy = 16;
  const size = t; // 0.4 ~ 1.0

  const ring = (pts, color) => {
    for (const [x, y] of pts) setPx(frame, x, y, color);
  };

  // rays
  const rays = [
    [4, 2],
    [3, 1],
    [3, 0],
    [6, 0],
    [6, 1],
    [14, 0],
    [14, 1],
    [26, 5],
    [27, 5],
    [28, 5],
    [28, 6],
    [29, 6],
    [29, 18],
    [30, 18],
    [30, 19],
    [31, 19],
    [22, 28],
    [22, 29],
    [22, 30],
    [23, 30],
    [8, 29],
    [8, 30],
    [1, 20],
    [0, 20],
    [0, 12],
    [1, 12],
    [5, 4],
    [24, 8],
    [25, 22],
  ];
  if (size >= 0.7) for (const [x, y] of rays) setPx(frame, x, y, C.blastR);

  // dark outline ellipse-ish
  const outline = [];
  const orange = [];
  const yellow = [];
  const core = [];

  const addDisk = (list, r, jitter = 0) => {
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        const dx = x - cx + 0.5;
        const dy = y - cy + 0.5;
        // cauliflower: distort radius
        const ang = Math.atan2(dy, dx);
        const bump = 1 + 0.18 * Math.sin(ang * 3) + 0.1 * Math.sin(ang * 5 + 1);
        const dist = Math.sqrt(dx * dx + dy * dy) / (r * bump * size);
        if (dist <= 1) list.push([x, y]);
      }
    }
  };

  const oR = 9.2;
  const yR = 6.4;
  const cR = 3.2;
  const outR = 10.4;

  addDisk(outline, outR);
  addDisk(orange, oR);
  addDisk(yellow, yR);
  addDisk(core, cR);

  // draw outer rim only (outline minus orange)
  const inOrange = new Set(orange.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of outline) {
    if (!inOrange.has(`${x},${y}`)) setPx(frame, x, y, C.blastR);
  }
  const inYellow = new Set(yellow.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of orange) {
    if (!inYellow.has(`${x},${y}`)) setPx(frame, x, y, C.blastO);
  }
  const inCore = new Set(core.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of yellow) {
    if (!inCore.has(`${x},${y}`)) setPx(frame, x, y, C.blastY);
  }
  for (const [x, y] of core) setPx(frame, x, y, C.blastC);

  // lobe accents
  fillRect(frame, 9, 7, 3, 2, C.blastO);
  fillRect(frame, 20, 8, 3, 2, C.blastO);
  fillRect(frame, 8, 18, 3, 2, C.blastO);
  fillRect(frame, 19, 19, 3, 2, C.blastO);
}

function fadeFrame(frame, alpha) {
  for (let i = 3; i < frame.length; i += 4) {
    frame[i] = Math.round(frame[i] * alpha);
  }
}

function buildSheet() {
  const frames = [];

  // 0: bomb idle
  {
    const f = makeFrame();
    drawBomb(f, 8, 8, false);
    frames.push(f);
  }
  // 1: bomb swell + crack
  {
    const f = makeFrame();
    drawBomb(f, 8, 8, true);
    frames.push(f);
  }
  // 2: crack + tiny blast peek
  {
    const f = makeFrame();
    drawBomb(f, 8, 8, true);
    // flash core
    fillRect(f, 14, 14, 4, 4, C.blastC);
    fillRect(f, 13, 13, 6, 1, C.blastY);
    fillRect(f, 13, 18, 6, 1, C.blastY);
    frames.push(f);
  }
  // 3: small blast
  {
    const f = makeFrame();
    drawBlast(f, 0.55);
    frames.push(f);
  }
  // 4: full blast
  {
    const f = makeFrame();
    drawBlast(f, 0.92);
    frames.push(f);
  }
  // 5: full hold
  {
    const f = makeFrame();
    drawBlast(f, 1.0);
    frames.push(f);
  }
  // 6: fade
  {
    const f = makeFrame();
    drawBlast(f, 1.05);
    fadeFrame(f, 0.55);
    frames.push(f);
  }
  // 7: almost gone
  {
    const f = makeFrame();
    drawBlast(f, 1.1);
    fadeFrame(f, 0.2);
    frames.push(f);
  }

  const rgba = Buffer.alloc(FW * FRAMES * FH * 4);
  for (let fi = 0; fi < FRAMES; fi++) {
    const fr = frames[fi];
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        const si = (y * FW + x) * 4;
        const di = (y * (FW * FRAMES) + fi * FW + x) * 4;
        rgba[di] = fr[si];
        rgba[di + 1] = fr[si + 1];
        rgba[di + 2] = fr[si + 2];
        rgba[di + 3] = fr[si + 3];
      }
    }
  }
  return encodePng(FW * FRAMES, FH, rgba);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buildSheet());
console.log("wrote", OUT, "frames", FRAMES, `${FW}x${FH}`);
