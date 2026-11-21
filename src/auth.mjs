// Auth: a single password (scrypt), device sessions (cookies), login rate limit, one-time tickets for the product origin.
import crypto from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { config, saveConfig, loadConfig, atomicWrite, readJsonFile, DATA } from './config.mjs';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const DEVICES_FILE = path.join(DATA, 'devices.json');
const LIFETIME = 30 * 86400e3;
export const MIN_PASSWORD = 10;

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const random = (n = 32) => crypto.randomBytes(n).toString('base64url');

// ---- password ----
export const hasPassword = () => Boolean(config.password?.hash);

export async function setPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new Error(`The password must be at least ${MIN_PASSWORD} characters`);
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password.normalize('NFKC'), salt, 64, SCRYPT)).toString('hex');
  loadConfig();
  config.password = { salt, hash };
  saveConfig();
}

export async function checkPassword(password) {
  if (!hasPassword() || typeof password !== 'string') return false;
  const candidate = await scrypt(password.normalize('NFKC'), config.password.salt, 64, SCRYPT);
  const actual = Buffer.from(config.password.hash, 'hex');
  return candidate.length === actual.length && crypto.timingSafeEqual(candidate, actual);
}

export function resetPassword() {
  loadConfig();
  config.password = null;
  saveConfig();
  devices = {};
  saveDevices();
}

// ---- login rate limit ----
const WINDOW = 15 * 60e3, LIMIT = 5, GLOBAL_WINDOW = 3600e3, GLOBAL_LIMIT = 40;
const attempts = new Map(); // client → [time]
let globalAttempts = [];

export function loginAllowed(client, now = Date.now()) {
  globalAttempts = globalAttempts.filter(t => now - t < GLOBAL_WINDOW);
  if (globalAttempts.length >= GLOBAL_LIMIT) return { allowed: false, wait: Math.ceil((globalAttempts[0] + GLOBAL_WINDOW - now) / 1000) };
  const list = (attempts.get(client) || []).filter(t => now - t < WINDOW);
  attempts.set(client, list);
  if (list.length >= LIMIT) return { allowed: false, wait: Math.ceil((list[0] + WINDOW - now) / 1000) };
  return { allowed: true, left: LIMIT - list.length };
}
export function loginFailed(client, now = Date.now()) {
  globalAttempts.push(now);
  attempts.set(client, [...(attempts.get(client) || []), now]);
}
export function loginSucceeded(client) { attempts.delete(client); }

// ---- device sessions ----
let devices = readJsonFile(DEVICES_FILE, {}); // sha256(token) → { kind, created, lastSeen, device, parent }
let savePending = null;
function saveDevices() { atomicWrite(DEVICES_FILE, JSON.stringify(devices)); }
function saveDevicesLater() {
  if (savePending) return;
  savePending = setTimeout(() => { savePending = null; saveDevices(); }, 5000);
  savePending.unref();
}

export function deviceName(ua = '') {
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${os} · ${browser}`;
}

/** kind: 'control' (the main session) or 'product' (cookie on the product origin; closed together with its parent). */
export function openSession(kind, device, parent = null) {
  const token = random();
  devices[sha256(token)] = { kind, created: Date.now(), lastSeen: Date.now(), device, parent };
  saveDevices();
  return token;
}

export function findSession(token, kind) {
  if (!token) return null;
  const key = sha256(token);
  const d = devices[key];
  if (!d || d.kind !== kind) return null;
  const now = Date.now();
  if (now - d.lastSeen > LIFETIME) { delete devices[key]; saveDevicesLater(); return null; }
  if (d.parent && !devices[d.parent]) { delete devices[key]; saveDevicesLater(); return null; }
  if (now - d.lastSeen > 60e3) { d.lastSeen = now; saveDevicesLater(); }
  return { ...d, key };
}

function removeKey(key) {
  delete devices[key];
  for (const [k, d] of Object.entries(devices)) if (d.parent === key) delete devices[k];
}
export function closeSession(token) { if (token) { removeKey(sha256(token)); saveDevices(); } }
export function closeDevice(key) { removeKey(key); saveDevices(); }
export function closeAll() { devices = {}; saveDevices(); }

export function deviceList(myKey) {
  return Object.entries(devices).filter(([, d]) => d.kind === 'control')
    .map(([k, d]) => ({ id: k.slice(0, 16), device: d.device, created: d.created, lastSeen: d.lastSeen, current: k === myKey }))
    .sort((x, y) => y.lastSeen - x.lastSeen);
}
export function deviceKey(shortId) { return Object.keys(devices).find(k => k.startsWith(shortId)); }

// ---- ticket for switching to the product origin (single use, 60 s) ----
const tickets = new Map();
export function issueTicket(parentKey) {
  const now = Date.now();
  for (const [t, d] of tickets) if (now - d.time > 60e3) tickets.delete(t);
  const ticket = random(24);
  tickets.set(ticket, { parent: parentKey, time: now });
  return ticket;
}
export function useTicket(ticket) {
  const d = tickets.get(ticket);
  if (!d) return null;
  tickets.delete(ticket);
  if (Date.now() - d.time > 60e3 || !devices[d.parent]) return null;
  return d;
}
