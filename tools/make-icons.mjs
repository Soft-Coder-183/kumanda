// Makes web/icon-192.png and web/icon-512.png (no dependencies; the same drawing as icon.svg).
// Run: node tools/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function png(size) {
  const scale = size / 512;
  const color = [0x4a, 0x45, 0xd6];
  const segments = [[150, 176, 246, 256], [246, 256, 150, 336], [276, 336, 368, 336]]; // ">" and "_"
  const thickness = 22;
  const distance = (x, y, [x1, y1, x2, y2]) => {
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
  };
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    const row = py * (size * 4 + 1);
    raw[row] = 0;
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / scale, y = (py + 0.5) / scale;
      // Maskable icon: the background is a full square (the operating system rounds the corners).
      const d = Math.min(...segments.map(s => distance(x, y, s))) - thickness;
      const white = Math.max(0, Math.min(1, 0.5 - d * scale));
      const i = row + 1 + px * 4;
      for (let k = 0; k < 3; k++) raw[i + k] = Math.round(color[k] + (255 - color[k]) * white);
      raw[i + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const web = path.resolve(import.meta.dirname, '..', 'web');
for (const s of [192, 512]) {
  fs.writeFileSync(path.join(web, `icon-${s}.png`), png(s));
  console.log(`wrote web/icon-${s}.png`);
}
