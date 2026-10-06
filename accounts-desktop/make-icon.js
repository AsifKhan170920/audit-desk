/* Draws assets/icon.png (256×256): a blue rounded tile with a white ledger sheet — no image tools needed. */
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const S = 256, px = Buffer.alloc(S * S * 4);
function set(x, y, r, g, b, a) { const i = (y * S + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; }
function inRound(x, y, x0, y0, x1, y1, rad) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + rad ? x0 + rad : x > x1 - rad ? x1 - rad : x, cy = y < y0 + rad ? y0 + rad : y > y1 - rad ? y1 - rad : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
}
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  if (!inRound(x, y, 8, 8, 247, 247, 48)) { set(x, y, 0, 0, 0, 0); continue; }
  const t = y / S; set(x, y, Math.round(37 - 17 * t), Math.round(99 - 40 * t), Math.round(235 - 60 * t), 255);   // #2563eb -> darker
  if (inRound(x, y, 64, 52, 192, 204, 14)) {                                                                     // the sheet
    set(x, y, 255, 255, 255, 255);
    const row = (y >= 88 && y <= 98) || (y >= 118 && y <= 128) || (y >= 148 && y <= 158) || (y >= 178 && y <= 188);
    if (row && x >= 84 && x <= 172) set(x, y, 37, 99, 235, 255);
    if (x >= 140 && x <= 146 && y >= 80 && y <= 192) set(x, y, 201, 151, 58, 255);                               // gold column line
  }
}
const raw = Buffer.alloc((S * 4 + 1) * S); for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
fs.mkdirSync(path.join(__dirname, 'assets'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'assets', 'icon.png'), png);
console.log('assets/icon.png', png.length, 'bytes');
