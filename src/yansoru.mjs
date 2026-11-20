// /btw yan soruları. Claude Code bunları kaydetmez: terminalde sorulan /btw'nin yalnızca sorusu ~/.claude/history.jsonl'e
// (istem geçmişi) düşer, yanıtı hiçbir yere yazılmaz. Kumanda iki şey yapar:
//  1. Kumanda'dan sorulan yan soruyu, sohbetin çatallanmış ve diske yazılmayan bir kopyasında araçsız yanıtlatır
//     (`--resume <oturum> --fork-session --no-session-persistence --tools ""`); asıl sohbet ve transkripti değişmez.
//     Soru ve yanıt veri klasöründe saklanır (`yan-sorular/<oturum>.jsonl`).
//  2. Terminalde sorulmuş /btw sorularını history.jsonl'den okuyup aynı sohbette (yanıtsız) gösterir.
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { VERI } from './ayar.mjs';
import { CLAUDE_DIZIN } from './projeler.mjs';
import { EFORLAR, MODELLER, claudeKomutu } from './oturumlar.mjs';

const DIZIN = path.join(VERI, 'yan-sorular');
const GECMIS = path.join(CLAUDE_DIZIN, 'history.jsonl');
const SURE = 3 * 60e3;
const EN_FAZLA = 3;
const KIMLIK = /^[0-9a-f-]{36}$/i;

const YONERGE = 'Bu bir yan sorudur (/btw): kullanıcı süren işi bölmeden kısa bir şey soruyor. Araç kullanamazsın; '
  + 'yalnızca bu konuşmada zaten bilinenlere dayanarak kısa ve doğrudan yanıt ver. Bilmiyorsan bunu söyle.';

const dosyasi = oturum => path.join(DIZIN, `${oturum}.jsonl`);
const suren = new Map(); // oturum → Map(kimlik → yanıt bekleyen soru)
let calisan = 0;

async function kayitlilar(oturum) {
  let metin;
  try { metin = await fsp.readFile(dosyasi(oturum), 'utf8'); } catch { return []; }
  const harita = new Map();
  for (const satir of metin.split('\n')) {
    if (!satir.trim()) continue;
    try { const o = JSON.parse(satir); if (o.id) harita.set(o.id, o); } catch { /* yarım satır */ }
  }
  return [...harita.values()];
}

// history.jsonl büyüyebilir: yalnızca eklenen kısmı okunur, /btw satırları oturuma göre tutulur.
const terminal = { okunan: 0, artik: '', anahtar: '', harita: new Map() };
async function terminalSorulari(oturum) {
  let st;
  try { st = await fsp.stat(GECMIS); } catch { return []; }
  if (st.size < terminal.okunan) Object.assign(terminal, { okunan: 0, artik: '', harita: new Map() }); // dosya kısaldı
  if (st.size > terminal.okunan) {
    const el = await fsp.open(GECMIS, 'r');
    try {
      const tampon = Buffer.alloc(st.size - terminal.okunan);
      const { bytesRead } = await el.read(tampon, 0, tampon.length, terminal.okunan);
      terminal.okunan += bytesRead;
      const satirlar = (terminal.artik + tampon.subarray(0, bytesRead).toString('utf8')).split('\n');
      terminal.artik = satirlar.pop();
      for (const satir of satirlar) {
        if (!satir.includes('"/btw')) continue;
        let o;
        try { o = JSON.parse(satir); } catch { continue; }
        const m = /^\/btw\s+(\S[\s\S]*)$/.exec(typeof o.display === 'string' ? o.display : '');
        if (!m || typeof o.sessionId !== 'string' || !Number.isFinite(o.timestamp)) continue;
        const liste = terminal.harita.get(o.sessionId) || [];
        liste.push({ id: `terminal-${o.timestamp}`, z: o.timestamp, soru: m[1].trim(), kaynak: 'terminal' });
        terminal.harita.set(o.sessionId, liste);
      }
    } finally { await el.close(); }
  }
  return terminal.harita.get(oturum) || [];
}

/** Bir sohbetin bütün yan soruları (Kumanda'dan sorulanlar, yanıtı bekleyenler, terminaldekiler), zamana göre. */
export async function yanSorular(oturum) {
  if (!KIMLIK.test(oturum)) return [];
  const hepsi = [...await kayitlilar(oturum), ...(suren.get(oturum)?.values() || []), ...await terminalSorulari(oturum)];
  return hepsi.sort((a, b) => a.z - b.z);
}

/** Geçmiş öğelerinin arasına yan soruları zamanlarına göre yerleştirir. */
export function arayaKat(ogeler, yanlar) {
  if (!yanlar.length) return ogeler;
  const sonuc = [];
  let i = 0;
  for (const o of ogeler) {
    while (i < yanlar.length && o.z && yanlar[i].z < o.z) sonuc.push({ ...yanlar[i++], t: 'btw' });
    sonuc.push(o);
  }
  while (i < yanlar.length) sonuc.push({ ...yanlar[i++], t: 'btw' });
  return sonuc;
}

function calistir(proje, oturum, soru, { model, efor }) {
  return new Promise((coz, reddet) => {
    const [komut, on] = claudeKomutu();
    const arg = [...on, '-p', '--output-format', 'json', '--resume', oturum, '--fork-session', '--no-session-persistence',
      '--tools', '', '--strict-mcp-config', '--append-system-prompt', YONERGE,
      ...(model ? ['--model', model] : []), ...(efor ? ['--effort', efor] : [])];
    const surec = spawn(komut, arg, { cwd: proje.yol, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let cikti = '', hata = '';
    surec.stdout.setEncoding('utf8').on('data', v => { cikti += v; });
    surec.stderr.setEncoding('utf8').on('data', v => { hata = (hata + v).slice(-1500); });
    const zaman = setTimeout(() => { surec.kill(); reddet(new Error('Yan soru 3 dakikada yanıtlanmadı')); }, SURE);
    surec.on('error', e => { clearTimeout(zaman); reddet(new Error(`Claude Code başlatılamadı: ${e.message}`)); });
    surec.on('exit', kod => {
      clearTimeout(zaman);
      const satir = cikti.trim().split('\n').reverse().find(s => s.trim().startsWith('{'));
      let r = null;
      try { r = satir ? JSON.parse(satir) : null; } catch { /* JSON değil */ }
      if (r && !r.is_error && typeof r.result === 'string') coz(r.result);
      else reddet(new Error(String(r?.result || hata.trim() || `Claude Code yanıt vermedi (kod ${kod})`).slice(0, 1500)));
    });
    surec.stdin.on('error', () => {});
    surec.stdin.end(soru);
  });
}

/** Yan soruyu yanıtlatır ve saklar. `yayinla(o)`: o an sohbet açıksa kartı canlı akışa düşürür. */
export async function yanSoruSor(proje, oturum, { id, soru, model, efor }, yayinla = () => {}) {
  if (calisan >= EN_FAZLA) throw Object.assign(new Error('Aynı anda en çok 3 yan soru sorulabilir'), { kod: 429 });
  if (!MODELLER.includes(model)) model = '';
  if (!EFORLAR.includes(efor)) efor = '';
  const o = { id, z: Date.now(), soru, kaynak: 'kumanda', model: model || null, bekliyor: true };
  if (!suren.has(oturum)) suren.set(oturum, new Map());
  suren.get(oturum).set(id, o);
  yayinla(o);
  calisan++;
  try { o.yanit = await calistir(proje, oturum, soru, { model, efor }); }
  catch (e) { o.hata = e.message; }
  finally {
    calisan--;
    suren.get(oturum)?.delete(id);
    if (!suren.get(oturum)?.size) suren.delete(oturum);
    delete o.bekliyor;
  }
  await fsp.mkdir(DIZIN, { recursive: true });
  await fsp.appendFile(dosyasi(oturum), JSON.stringify(o) + '\n');
  yayinla(o);
  return o;
}

export const yanSoruVar = async (oturum, id) => (suren.get(oturum)?.has(id)) || (await kayitlilar(oturum)).some(o => o.id === id);
