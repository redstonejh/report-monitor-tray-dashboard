// Generates tray PNG icons using only Node.js built-ins (no extra packages).
// Each status is a filled circle in the unified status palette (matching the
// popover) with a distinct glyph — so the state is never conveyed by color
// alone (green ✓, amber !, red ✕, stale –, connecting plain).
import zlib from 'zlib';
import { nativeImage } from 'electron';

// ─── Minimal PNG encoder ──────────────────────────────────────────────────────

function crc32(data) {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let crc = -1;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

function encodePng(size, raw) {
  const compressed = zlib.deflateSync(raw, { level: 6 });
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Geometry ─────────────────────────────────────────────────────────────────

// Distance from point (px,py) to segment (ax,ay)-(bx,by).
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Glyph strokes as segments in fractional [0..1] coordinates of the icon box.
const GLYPHS = {
  check: [[0.28, 0.54, 0.43, 0.67], [0.43, 0.67, 0.73, 0.33]],
  bang:  [[0.50, 0.29, 0.50, 0.55], [0.50, 0.655, 0.50, 0.66]],
  cross: [[0.35, 0.35, 0.65, 0.65], [0.65, 0.35, 0.35, 0.65]],
  dash:  [[0.33, 0.50, 0.67, 0.50]],
  none:  [],
};

function makeStatusPng(size, hexFill, glyphKey) {
  const r = parseInt(hexFill.slice(1, 3), 16);
  const g = parseInt(hexFill.slice(3, 5), 16);
  const b = parseInt(hexFill.slice(5, 7), 16);
  // Dark glyph on light fills (amber), white glyph otherwise — for contrast.
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const gr = lum > 165 ? 21 : 255;
  const gg = lum > 165 ? 22 : 255;
  const gb = lum > 165 ? 26 : 255;

  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 1.5;
  const halfW = size * 0.058;
  const segs = (GLYPHS[glyphKey] || []).map((s) => s.map((v) => v * size));

  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride, 0);

  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const dist = Math.hypot(px - cx, py - cy);
      const circleCov = clamp01(outerR + 0.5 - dist);
      const idx = y * stride + 1 + x * 4;
      if (circleCov <= 0) continue; // outside circle stays transparent

      let minSeg = Infinity;
      for (const s of segs) {
        const d = distToSegment(px, py, s[0], s[1], s[2], s[3]);
        if (d < minSeg) minSeg = d;
      }
      const glyphCov = segs.length ? clamp01(halfW + 0.5 - minSeg) : 0;

      raw[idx]     = Math.round(r * (1 - glyphCov) + gr * glyphCov);
      raw[idx + 1] = Math.round(g * (1 - glyphCov) + gg * glyphCov);
      raw[idx + 2] = Math.round(b * (1 - glyphCov) + gb * glyphCov);
      raw[idx + 3] = Math.round(255 * circleCov);
    }
  }

  return encodePng(size, raw);
}

// ─── Icons ──────────────────────────────────────────────────────────────────

// Rendered at 32px so it stays crisp when Windows scales the tray icon for
// higher-DPI displays. Colors match the unified status palette (App.css).
const ICON_SIZE = 32;
const makeIcon = (hex, glyph) => nativeImage.createFromBuffer(makeStatusPng(ICON_SIZE, hex, glyph));

const icons = {
  green:  makeIcon('#32d74b', 'check'),
  yellow: makeIcon('#ffd60a', 'bang'),
  red:    makeIcon('#ff453a', 'cross'),
  grey:   makeIcon('#8e8e93', 'none'),
  black:  makeIcon('#3a3a3c', 'dash'),
};

export { icons, makeStatusPng };
