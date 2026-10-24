/**
 * NMI Merchant Sign-Up API client (server-side only).
 * @see https://docs.nmi.com/reference/sign-up-api
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function loadDotEnv() {
  const file = path.join(root, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv();

const BASE = () =>
  (process.env.NMI_BASE_URL || 'https://sandbox.signup.nmi.com/api/v1').replace(/\/$/, '');

let cachedToken = null;
let cachedExpiresAt = 0;

export function nmiConfigStatus() {
  return {
    base_url: BASE(),
    client_id_set: Boolean(process.env.NMI_CLIENT_ID && process.env.NMI_CLIENT_ID !== 'replace_me'),
    client_secret_set: Boolean(
      process.env.NMI_CLIENT_SECRET && process.env.NMI_CLIENT_SECRET !== 'replace_me',
    ),
    scope: process.env.NMI_SCOPE || '*',
    default_package_id: process.env.NMI_DEFAULT_PACKAGE_ID || null,
  };
}

/** Local receiver path (fixed). webhook.cool should forward here. */
export const NMI_WEBHOOK_PATH = '/api/webhooks/nmi';

/**
 * Webhook config for webhook.cool (or any tunnel).
 *
 * - Paste `full_url` (= NMI_WEBHOOK_PUBLIC_URL) into the NMI partner portal
 * - In webhook.cool, set Destination / Forward to `local_url`
 * - Do not append /api/webhooks/nmi onto the webhook.cool public URL
 */
export function webhookConfigStatus() {
  const publicBase = (process.env.NMI_WEBHOOK_PUBLIC_URL || '').replace(/\/$/, '');
  const secret = (process.env.NMI_WEBHOOK_SECRET || '').trim();
  const port = Number(process.env.NMI_API_PORT || 5191);
  const localUrl = `http://127.0.0.1:${port}${NMI_WEBHOOK_PATH}`;
  return {
    path: NMI_WEBHOOK_PATH,
    public_url: publicBase || null,
    // URL to register with NMI (webhook.cool inbox root — no path suffix)
    full_url: publicBase || null,
    local_url: localUrl,
    secret_set: Boolean(secret && secret !== 'replace_me'),
  };
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedExpiresAt - 60_000) return cachedToken;

  const clientId = process.env.NMI_CLIENT_ID;
  const clientSecret = process.env.NMI_CLIENT_SECRET;
  if (!clientId || !clientSecret || clientId === 'replace_me') {
    const err = new Error(
      'Set NMI_CLIENT_ID and NMI_CLIENT_SECRET in nmi/.env (see .env.example).',
    );
    err.status = 503;
    throw err;
  }

  const res = await fetch(`${BASE()}/oauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: process.env.NMI_SCOPE || '*',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || `OAuth failed (${res.status})`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  cachedToken = data.access_token;
  const ttlSec = Number(data.expires_in) || 3600;
  cachedExpiresAt = now + ttlSec * 1000;
  return cachedToken;
}

async function nmiFetch(method, pathName, { body, idempotencyKey, query } = {}) {
  const token = await getAccessToken();
  const url = new URL(`${BASE()}${pathName.startsWith('/') ? pathName : `/${pathName}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const payloadJson = body !== undefined ? JSON.stringify(body) : undefined;
  if (process.env.NMI_DEBUG_HTTP === '1' || process.env.NMI_DEBUG_HTTP === 'true') {
    console.log(`[NMI] → ${method} ${url.toString()}`);
    if (payloadJson) console.log(`[NMI] body: ${payloadJson.slice(0, 4000)}`);
  }

  const res = await fetch(url, {
    method,
    headers,
    body: payloadJson,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    // Always log failures — CRASH from NMI is opaque; payload shape is the usual cause.
    console.error(`[NMI] ← ${res.status} ${method} ${url.toString()}`);
    console.error(`[NMI] response: ${text.slice(0, 2000)}`);
    if (payloadJson) console.error(`[NMI] sent body: ${payloadJson.slice(0, 4000)}`);
    const detail =
      data.message ||
      data.error ||
      (Array.isArray(data.errors) ? JSON.stringify(data.errors) : null) ||
      `NMI request failed (${res.status})`;
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export function listPackages(query = {}) {
  return nmiFetch('GET', '/packages', { query });
}

export function getPackage(packageId) {
  return nmiFetch('GET', `/packages/${encodeURIComponent(packageId)}`);
}

export function listApplications(query = {}) {
  return nmiFetch('GET', '/applications', { query });
}

export function getApplication(applicationId) {
  return nmiFetch('GET', `/applications/${encodeURIComponent(applicationId)}`);
}

export function createApplication({ package_id, fields, collections }, idempotencyKey) {
  return nmiFetch('POST', '/applications', {
    body: { package_id, fields, collections: collections || [] },
    idempotencyKey: idempotencyKey || randomUUID(),
  });
}

export function updateApplication(applicationId, { fields, collections }, idempotencyKey) {
  return nmiFetch('PATCH', `/applications/${encodeURIComponent(applicationId)}`, {
    body: { fields, collections },
    idempotencyKey: idempotencyKey || randomUUID(),
  });
}

export function getLegalConsent(applicationId) {
  return nmiFetch('GET', `/applications/${encodeURIComponent(applicationId)}/legal-consent`);
}

export function submitApplication(applicationId, { skipMerchantEmail = false } = {}) {
  return nmiFetch('POST', `/applications/${encodeURIComponent(applicationId)}/submit`, {
    query: skipMerchantEmail ? { skip_merchant_email: 'true' } : undefined,
    idempotencyKey: randomUUID(),
  });
}

/** Verify NMI webhook Signature header (HMAC-SHA256 of raw body). */
export function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.NMI_WEBHOOK_SECRET || '';
  if (!secret) return { ok: false, reason: 'NMI_WEBHOOK_SECRET not set' };
  if (!signatureHeader) return { ok: false, reason: 'Missing Signature header' };
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = String(signatureHeader).trim();
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return { ok: false, reason: 'Signature mismatch' };
    return { ok: timingSafeEqual(a, b), reason: timingSafeEqual(a, b) ? null : 'Signature mismatch' };
  } catch {
    return { ok: false, reason: 'Signature mismatch' };
  }
}

export { randomUUID };
