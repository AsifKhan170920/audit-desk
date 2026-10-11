/* Draws the Kazabooks mark – a white "K" on a navy rounded tile with a gold line – as a PNG.
     node make-icon.js                → assets/icon.png (256×256, the Windows / Mac app)
     node make-icon.js 512 out.png    → any size (the website's icons)
     node make-icon.js 432 out.png fg → Android adaptive-icon foreground: only the K and the line, small in the
                                        middle of a clear square (the launcher puts the navy behind it)
   The shape is described on a 256 grid and drawn 4×4 supersampled, so every size has smooth edges.
   No image tools needed. */
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const N = +process.argv[2] || 256, OUT = process.argv[3] || path.join(__dirname, 'assets', 'icon.png');
const FG = process.argv[4] === 'fg', FG_SCALE = 0.62;   // the tile's share of the foreground square
const SS = 4, G = 256;   // supersampling, design grid

function inRound(x, y, x0, y0, x1, y1, rad) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + rad ? x0 + rad : x > x1 - rad ? x1 - rad : x, cy = y < y0 + rad ? y0 + rad : y > y1 - rad ? y1 - rad : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
}
function nearSeg(x, y, ax, ay, bx, by, w) {   // within w/2 of the segment a–b
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= (w / 2) ** 2;
}
/** the colour at a point of the 256 grid: [r, g, b, a] */
function paint(x, y) {
  if (FG) { x = 128 + (x - 128) / FG_SCALE; y = 128 + (y - 128) / FG_SCALE; }
  if (!inRound(x, y, 8, 8, 248, 248, 52)) return [0, 0, 0, 0];
  const t = y / G;
  const k = ((x >= 72 && x <= 106) || nearSeg(x, y, 100, 132, 178, 62, 36) || nearSeg(x, y, 112, 120, 182, 194, 36)) && y >= 60 && y <= 196;
  if (k) return [255, 255, 255, 255];
  if (y >= 214 && y <= 222 && x >= 72 && x <= 184) return [201, 151, 58, 255];   // the gold line
  if (FG) return [0, 0, 0, 0];
  return [Math.round(26 - 8 * t), Math.round(52 - 16 * t), Math.round(96 - 30 * t), 255];   // navy, a little darker at the bottom
}
const out = Buffer.alloc(N * N * 4);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const acc = [0, 0, 0, 0];
  for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
    const c = paint((x + (sx + 0.5) / SS) * G / N, (y + (sy + 0.5) / SS) * G / N);
    acc[0] += c[0] * c[3]; acc[1] += c[1] * c[3]; acc[2] += c[2] * c[3]; acc[3] += c[3];
  }
  const o = (y * N + x) * 4;
  out[o + 3] = Math.round(acc[3] / (SS * SS));
  for (let i = 0; i < 3; i++) out[o + i] = acc[3] ? Math.round(acc[i] / acc[3]) : 0;
}
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; out.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4); }
const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log(OUT, png.length, 'bytes');
