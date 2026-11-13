// web/ikon-192.png ve web/ikon-512.png dosyalarını üretir (bağımlılıksız; ikon.svg ile aynı çizim).
// Çalıştır: node araclar/ikon-uret.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function png(boyut) {
  const o = boyut / 512;
  const renk = [0x4a, 0x45, 0xd6];
  const parcalar = [[150, 176, 246, 256], [246, 256, 150, 336], [276, 336, 368, 336]]; // ">" ve "_"
  const kalinlik = 22;
  const uzaklik = (x, y, [x1, y1, x2, y2]) => {
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
  };
  const ham = Buffer.alloc((boyut * 4 + 1) * boyut);
  for (let py = 0; py < boyut; py++) {
    const satir = py * (boyut * 4 + 1);
    ham[satir] = 0;
    for (let px = 0; px < boyut; px++) {
      const x = (px + 0.5) / o, y = (py + 0.5) / o;
      // Maskelenebilir simge: zemin tam kare (köşeleri işletim sistemi yuvarlar).
      const d = Math.min(...parcalar.map(p => uzaklik(x, y, p))) - kalinlik;
      const beyaz = Math.max(0, Math.min(1, 0.5 - d * o));
      const i = satir + 1 + px * 4;
      for (let k = 0; k < 3; k++) ham[i + k] = Math.round(renk[k] + (255 - renk[k]) * beyaz);
      ham[i + 3] = 255;
    }
  }
  const parca = (tur, veri) => {
    const govde = Buffer.concat([Buffer.from(tur), veri]);
    const uzunluk = Buffer.alloc(4); uzunluk.writeUInt32BE(veri.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(govde));
    return Buffer.concat([uzunluk, govde, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(boyut, 0); ihdr.writeUInt32BE(boyut, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), parca('IHDR', ihdr), parca('IDAT', zlib.deflateSync(ham, { level: 9 })), parca('IEND', Buffer.alloc(0))]);
}

const web = path.resolve(import.meta.dirname, '..', 'web');
for (const b of [192, 512]) {
  fs.writeFileSync(path.join(web, `ikon-${b}.png`), png(b));
  console.log(`web/ikon-${b}.png yazıldı`);
}
