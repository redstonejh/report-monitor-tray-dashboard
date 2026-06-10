// Generates tray PNG icons using only Node.js built-ins (no extra packages).
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
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeInt32BE(crc32(crcInput));
  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

/**
 * Create a PNG NativeImage of a colored circle with an optional white inner ring
 * to make it look like a status light.
 */
function makeCircleIcon(size, hexFill) {
  const r = parseInt(hexFill.slice(1, 3), 16);
  const g = parseInt(hexFill.slice(3, 5), 16);
  const b = parseInt(hexFill.slice(5, 7), 16);

  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 1;
  const innerR = outerR * 0.55; // white highlight ring

  // RGBA row data (filter byte 0 per row)
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride, 0);

  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const px = y * stride + 1 + x * 4;

      if (dist <= outerR) {
        if (dist <= innerR) {
          // Bright center highlight
          const t = 1 - dist / innerR;
          const bright = Math.round(255 * t * 0.4);
          raw[px]     = Math.min(255, r + bright);
          raw[px + 1] = Math.min(255, g + bright);
          raw[px + 2] = Math.min(255, b + bright);
          raw[px + 3] = 255;
        } else {
          raw[px]     = r;
          raw[px + 1] = g;
          raw[px + 2] = b;
          raw[px + 3] = 255;
        }
      }
      // outside circle: stays transparent (0,0,0,0)
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });

  const ihdrData = Buffer.allocUnsafe(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8]  = 8; // bit depth
  ihdrData[9]  = 6; // color type RGBA
  ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

  return nativeImage.createFromBuffer(png);
}

// Pre-build all three icons at import time so tray updates are instant.
const ICON_SIZE = 22;

const icons = {
  green:   makeCircleIcon(ICON_SIZE, '#52c41a'),
  yellow:  makeCircleIcon(ICON_SIZE, '#faad14'),
  red:     makeCircleIcon(ICON_SIZE, '#ff4d4f'),
  grey:    makeCircleIcon(ICON_SIZE, '#8c8c8c'),
  black:   makeCircleIcon(ICON_SIZE, '#404040'),
};

export { icons };
