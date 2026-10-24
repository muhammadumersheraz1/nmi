/**
 * NMI Online Payments REST (v5) + Classic Query API.
 * Uses merchant private security key (not Sign-Up OAuth).
 * Optional per-request override via withMerchantKey() (application-wise keys).
 * @see https://docs.nmi.com/reference/create-sale-v5
 * @see https://docs.nmi.com/reference/authentication
 * @see https://docs.nmi.com/reference/query
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const merchantKeyStore = new AsyncLocalStorage();

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

const REST_BASE = () =>
  (process.env.NMI_GATEWAY_BASE_URL || 'https://sandbox.nmi.com/api').replace(/\/$/, '');

const QUERY_URL = () =>
  process.env.NMI_QUERY_URL || `${REST_BASE()}/query.php`;

function envMerchantKey() {
  return (process.env.NMI_MERCHANT_API_KEY || '').trim();
}

function merchantKey() {
  const override = merchantKeyStore.getStore();
  const key = (override || envMerchantKey() || '').trim();
  if (!key || key === 'replace_me') {
    const err = new Error(
      'Set a merchant security key: paste one for the selected application, or set NMI_MERCHANT_API_KEY in nmi/.env (Merchant Portal → Settings → Security Keys).',
    );
    err.status = 503;
    throw err;
  }
  return key;
}

/** Run gateway calls with an optional per-application merchant private key. */
export function withMerchantKey(overrideKey, fn) {
  const key = (overrideKey || '').trim();
  if (!key) return fn();
  return merchantKeyStore.run(key, fn);
}

/** Bind a merchant key for the rest of this HTTP request (from X-NMI-Merchant-Key). */
export function enterMerchantKey(overrideKey) {
  const key = (overrideKey || '').trim();
  if (key) merchantKeyStore.enterWith(key);
}

export function gatewayConfigStatus() {
  const key = envMerchantKey();
  return {
    gateway_base_url: REST_BASE(),
    query_url: QUERY_URL(),
    merchant_api_key_set: Boolean(key && key !== 'replace_me'),
  };
}

async function rest(method, pathName, body) {
  const res = await fetch(`${REST_BASE()}${pathName.startsWith('/') ? pathName : `/${pathName}`}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: merchantKey(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const detail =
      data.message ||
      data.error ||
      data.detail ||
      (typeof data === 'object' ? JSON.stringify(data).slice(0, 400) : text) ||
      `Gateway request failed (${res.status})`;
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/** Classic query.php — form POST, usually XML response. */
export async function queryTransactions(params = {}) {
  const body = new URLSearchParams();
  body.set('security_key', merchantKey());
  body.set('report_type', params.report_type || 'transaction');
  if (params.transaction_id) body.set('transaction_id', params.transaction_id);
  if (params.start_date) body.set('start_date', params.start_date);
  if (params.end_date) body.set('end_date', params.end_date);
  if (params.condition) body.set('condition', params.condition);
  if (params.result_limit) body.set('result_limit', String(params.result_limit));

  const res = await fetch(QUERY_URL(), {
    method: 'POST',
    headers: {
      Accept: 'application/xml, text/xml, */*',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Query API failed (${res.status})`);
    err.status = res.status;
    err.body = { raw: text };
    throw err;
  }
  return {
    format: 'xml',
    raw: text,
    transactions: parseTransactionXml(text),
  };
}

function tagValue(block, tag) {
  const hit = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return hit ? hit[1].trim() : null;
}

function parseActionsXml(block) {
  const actions = [];
  const re = /<action>([\s\S]*?)<\/action>/gi;
  let m;
  while ((m = re.exec(block))) {
    const a = m[1];
    actions.push({
      action_type: tagValue(a, 'action_type'),
      amount: tagValue(a, 'amount'),
      date: tagValue(a, 'date'),
      success: tagValue(a, 'success'),
      response_text: tagValue(a, 'responsetext') || tagValue(a, 'response_text'),
      response_code: tagValue(a, 'response_code'),
    });
  }
  return actions;
}

function parseTransactionXml(xml) {
  const rows = [];
  const re = /<transaction>([\s\S]*?)<\/transaction>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const actions = parseActionsXml(block);
    const last = actions[actions.length - 1] || {};
    const first = actions[0] || {};
    rows.push({
      transaction_id: tagValue(block, 'transaction_id'),
      condition: tagValue(block, 'condition'),
      action_type:
        last.action_type ||
        first.action_type ||
        tagValue(block, 'action_type') ||
        tagValue(block, 'transaction_type'),
      amount: last.amount || first.amount || tagValue(block, 'amount'),
      currency: tagValue(block, 'currency'),
      cc_number: tagValue(block, 'cc_number'),
      first_name: tagValue(block, 'first_name'),
      last_name: tagValue(block, 'last_name'),
      email: tagValue(block, 'email'),
      date: last.date || first.date || tagValue(block, 'date') || tagValue(block, 'action_date'),
      order_id: tagValue(block, 'order_id'),
      success: last.success ?? first.success ?? null,
      response_text: last.response_text || first.response_text || tagValue(block, 'responsetext'),
      response_code: last.response_code || first.response_code || null,
      actions,
    });
  }
  return rows;
}

export function sale(payload) {
  return rest('POST', '/v5/payments/sale', payload);
}

export function authorize(payload) {
  return rest('POST', '/v5/payments/auth', payload);
}

export function capture(paymentId, payload = {}) {
  return rest('POST', `/v5/payments/${encodeURIComponent(paymentId)}/capture`, payload);
}

export function voidPayment(paymentId, payload = {}) {
  return rest('POST', `/v5/payments/${encodeURIComponent(paymentId)}/void`, payload);
}

export function refund(paymentId, payload = {}) {
  return rest('POST', `/v5/payments/${encodeURIComponent(paymentId)}/refund`, payload);
}

export function getPayment(paymentId) {
  return rest('GET', `/v5/payments/${encodeURIComponent(paymentId)}`);
}

export function listCustomers(query = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const suffix = qs.toString() ? `?${qs}` : '';
  return rest('GET', `/v5/customers${suffix}`);
}

export function createCustomer(payload) {
  return rest('POST', '/v5/customers', payload);
}

export function getCustomer(customerId) {
  return rest('GET', `/v5/customers/${encodeURIComponent(customerId)}`);
}

export const TEST_CARDS = {
  visa: '4111111111111111',
  mastercard: '5431111111111111',
  discover: '6011000991300009',
  amex: '341111111111111',
  note: 'Sandbox only — https://docs.nmi.com/docs/integration-guide-test-and-deploy',
};
