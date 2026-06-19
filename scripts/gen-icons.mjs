// Dependency-free PNG icon generator. Draws a simple radar-scope app icon
// (dark background, accent rings + sweep wedge) at the sizes a PWA needs.
// Run: node scripts/gen-icons.mjs   → writes public/*.png
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(pub, { recursive: true });

// ---- minimal PNG encoder (RGBA, 8-bit) ----
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // raw: each row prefixed with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- draw the radar icon ----
function drawIcon(size, { ringScale = 0.46 } = {}) {
  const bg = [11, 15, 20];
  const accent = [79, 195, 247];
  const wedge = [
    Math.round(bg[0] * 0.55 + accent[0] * 0.45),
    Math.round(bg[1] * 0.55 + accent[1] * 0.45),
    Math.round(bg[2] * 0.55 + accent[2] * 0.45),
  ];
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const R = size * ringScale;
  const ringW = Math.max(2, size * 0.014);
  const rings = [R, R * 0.66, R * 0.36];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let c = bg;
      const dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      let ang = Math.atan2(dy, dx); // -PI..PI
      // sweep wedge (upper-right), ~55°
      if (d < R * 0.98 && ang <= -0.08 && ang >= -1.05) c = wedge;
      // concentric rings
      for (const r of rings) if (Math.abs(d - r) <= ringW) c = accent;
      // crosshair lines
      if ((Math.abs(dx) <= ringW * 0.55 || Math.abs(dy) <= ringW * 0.55) && d < R * 0.98) c = accent;
      // center dot
      if (d <= size * 0.05) c = accent;
      buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
    }
  }
  return encodePNG(size, buf);
}

const targets = [
  ['icon-192.png', 192, 0.46],
  ['icon-512.png', 512, 0.46],
  ['icon-maskable-512.png', 512, 0.36], // extra padding for maskable safe zone
  ['apple-touch-icon.png', 180, 0.46],
  ['favicon.png', 48, 0.46],
];
for (const [name, size, ringScale] of targets) {
  writeFileSync(path.join(pub, name), drawIcon(size, { ringScale }));
  console.log('wrote', name, size + 'px');
}
