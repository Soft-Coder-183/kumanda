// Ayarlar ve gizli veriler proje klasöründe DEĞİL, %LOCALAPPDATA%\Kumanda içinde durur:
// böylece ürün sunucusu ya da bir git commit'i şifre özetini / oturum kayıtlarını dışarı çıkaramaz.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const KOK = path.resolve(import.meta.dirname, '..');
export const VERI = process.env.KUMANDA_VERI
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.kumanda'), 'Kumanda');
fs.mkdirSync(VERI, { recursive: true });

const DOSYA = path.join(VERI, 'ayar.json');

const varsayilan = () => ({
  kumandaPort: 7777,
  urunPort: 7778,
  dinle: '127.0.0.1',          // yalnızca bu bilgisayar; uzak erişim tünelle (uzak-kur.ps1) gelir
  kokler: [path.dirname(KOK)], // alt klasörleri proje sayılan klasörler
  ekProjeler: [],              // köklerin dışındaki tekil proje klasörleri
  gizliProjeler: [],           // proje kimlikleri
  gizliUrunler: {},            // proje kimliği → [göreli yol]
  kamu: {},                    // kumanda host'u → ürün kökeni (özel tünel eşlemesi; Tailscale için gerekmez)
  claude: null,                // claude.exe yolu ya da [komut, ...argümanlar]; boşsa PATH'teki "claude"
  bosKapanmaDk: 20,            // boşta duran Claude süreci kaç dakika sonra kapatılır
  bildirimIletisim: 'mailto:kumanda@example.com',
  sifre: null,                 // { tuz, ozet } (scrypt)
});

export const ayar = varsayilan();

export function atomikYaz(dosya, metin) {
  const gecici = `${dosya}.${process.pid}.tmp`;
  fs.writeFileSync(gecici, metin);
  fs.renameSync(gecici, dosya);
}

export function jsonOkuDosya(dosya, yedek) {
  try { return JSON.parse(fs.readFileSync(dosya, 'utf8')); } catch { return yedek; }
}

export function ayarYukle() {
  const okunan = jsonOkuDosya(DOSYA, {});
  const taze = { ...varsayilan(), ...okunan };
  for (const k of Object.keys(ayar)) delete ayar[k];
  Object.assign(ayar, taze);
  return ayar;
}

export function ayarKaydet() {
  atomikYaz(DOSYA, JSON.stringify(ayar, null, 2));
}

ayarYukle();
if (!fs.existsSync(DOSYA)) ayarKaydet();

// Başka bir süreç (kurulum betiği, --sifre-sifirla) dosyayı değiştirirse çalışan sunucu görsün.
export function ayarIzle() {
  fs.watchFile(DOSYA, { interval: 3000 }, () => ayarYukle()).unref();
}
