// Web Push (VAPID) notifications to the phone: "done" / "waiting for permission".
// Pushes carry NO payload: the push service (Google/Mozilla/Apple) only receives a "wake up" signal; the service
// worker (sw.js) then fetches the text from /api/push/last with its own cookie. So no encryption library is needed and
// the notification text never passes through third parties.
import crypto from 'node:crypto';
import path from 'node:path';
import { config, atomicWrite, readJsonFile, DATA } from './config.mjs';

const FILE = path.join(DATA, 'push.json');
let state = readJsonFile(FILE, null);
if (!state?.privateKey) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  state = {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url'),
    subscribers: {}, // endpoint → { device, time }
  };
  save();
}
function save() { atomicWrite(FILE, JSON.stringify(state)); }

export const publicKey = () => state.publicKey;

export function subscribe(device, endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('Invalid subscription'); }
  if (url.protocol !== 'https:') throw new Error('Invalid subscription');
  state.subscribers[endpoint] = { device, time: Date.now() };
  save();
}
export function unsubscribe(endpoint) { if (state.subscribers[endpoint]) { delete state.subscribers[endpoint]; save(); } }
export const subscriberCount = () => Object.keys(state.subscribers).length;

let last = null;
export const lastNotification = () => last;

async function push(endpoint) {
  const url = new URL(endpoint);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ typ: 'JWT', alg: 'ES256' })}.${b64({ aud: url.origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: config.pushContact })}`;
  const signature = crypto.sign('sha256', Buffer.from(body), { key: state.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { TTL: '3600', Urgency: 'high', 'Content-Length': '0', Authorization: `vapid t=${body}.${signature}, k=${state.publicKey}` },
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 404 || response.status === 410) unsubscribe(endpoint); // subscription was cancelled
  return response.status;
}

/** deviceValid: drops subscriptions of devices whose session was closed. */
export async function notify(notification, deviceValid = () => true) {
  last = { ...notification, time: Date.now() };
  const results = [];
  for (const [endpoint, s] of Object.entries(state.subscribers)) {
    if (!deviceValid(s.device)) { unsubscribe(endpoint); continue; }
    results.push(push(endpoint).catch(e => `error: ${e.message}`));
  }
  return Promise.all(results);
}
