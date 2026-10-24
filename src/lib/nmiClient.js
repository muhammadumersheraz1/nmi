/**
 * Browser → NMI APIs directly (visible in DevTools Network).
 * Sign-Up: https://sandbox.signup.nmi.com (CORS allowed)
 * Gateway: Vite proxies /nmi-gateway → https://sandbox.nmi.com/api (gateway blocks browser CORS)
 */
import {
  getActiveMerchant,
  resolvePrivateKey,
  resolvePublicKey,
} from './merchantSession.js';

function env(name, fallback = '') {
  const v = import.meta.env[name];
  return v == null || v === '' ? fallback : String(v);
}

export function signupBase() {
  return (env('NMI_BASE_URL', 'https://sandbox.signup.nmi.com/api/v1') || '').replace(/\/$/, '');
}

/** Browser path that Vite rewrites to sandbox.nmi.com/api */
export function gatewayBase() {
  // Direct would be https://sandbox.nmi.com/api — CORS blocked; use Vite proxy prefix.
  return env('VITE_NMI_GATEWAY_PROXY', '/nmi-gateway').replace(/\/$/, '');
}

export function configStatus() {
  const clientId = env('NMI_CLIENT_ID');
  const clientSecret = env('NMI_CLIENT_SECRET');
  const envMerchantKey = env('NMI_MERCHANT_API_KEY');
  const envPublicKey = env('NMI_PUBLIC_API_KEY') || env('NMI_TOKENIZATION_KEY');
  const partnerKeyVal = env('NMI_PARTNER_API_KEY');
  const active = getActiveMerchant();
  const merchantKey = resolvePrivateKey(envMerchantKey);
  const publicKey = resolvePublicKey(envPublicKey);
  return {
    ok: true,
    service: 'nmi-direct-browser',
    signup: {
      base_url: signupBase(),
      client_id_set: Boolean(clientId && clientId !== 'replace_me'),
      client_secret_set: Boolean(clientSecret && clientSecret !== 'replace_me'),
      scope: env('NMI_SCOPE', '*'),
      default_package_id: env('NMI_DEFAULT_PACKAGE_ID') || null,
      mode: 'direct',
    },
    partner: {
      partner_api_key_set: Boolean(partnerKeyVal && partnerKeyVal !== 'replace_me'),
      merchants_list: 'POST /v4/merchants/reports',
      merchants_create: 'POST /v4/merchants',
      mode: 'vite-proxy',
    },
    gateway: {
      gateway_base_url: 'https://sandbox.nmi.com/api',
      browser_base: gatewayBase(),
      query_url: 'https://sandbox.nmi.com/api/query.php',
      merchant_api_key_set: Boolean(merchantKey && merchantKey !== 'replace_me'),
      public_api_key_set: Boolean(publicKey && publicKey !== 'replace_me'),
      active_merchant_id: active?.merchantId || null,
      active_merchant_company: active?.company || null,
      key_source: active?.privateKey ? 'session' : 'env',
      mode: 'vite-proxy', // Network shows /nmi-gateway/* → NMI; Sign-Up shows real NMI host
    },
    webhook: {
      path: '/api/webhooks/nmi',
      public_url: env('NMI_WEBHOOK_PUBLIC_URL') || null,
      full_url: env('NMI_WEBHOOK_PUBLIC_URL') || null,
      local_url: null,
      secret_set: Boolean(env('NMI_WEBHOOK_SECRET')),
      note: 'Webhook receiver needs a public URL (webhook.cool). Sign-Up calls are direct to NMI.',
    },
  };
}

let cachedToken = null;
let cachedExpiresAt = 0;

export async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedExpiresAt - 60_000) return cachedToken;

  const clientId = env('NMI_CLIENT_ID');
  const clientSecret = env('NMI_CLIENT_SECRET');
  if (!clientId || !clientSecret || clientId === 'replace_me') {
    throw new Error('Set NMI_CLIENT_ID and NMI_CLIENT_SECRET in nmi/.env (Vite exposes them to the browser for this sandbox sample).');
  }

  const res = await fetch(`${signupBase()}/oauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: env('NMI_SCOPE', '*'),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `OAuth failed (${res.status})`);
  }
  cachedToken = data.access_token;
  cachedExpiresAt = now + (Number(data.expires_in) || 3600) * 1000;
  return cachedToken;
}

async function signupFetch(method, pathName, { body, idempotencyKey, query } = {}) {
  const token = await getAccessToken();
  const url = new URL(`${signupBase()}${pathName.startsWith('/') ? pathName : `/${pathName}`}`);
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

  const res = await fetch(url.toString(), {
    method,
    headers,
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
      (Array.isArray(data.errors) ? JSON.stringify(data.errors) : null) ||
      `NMI Sign-Up failed (${res.status})`;
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function merchantKey() {
  const key = resolvePrivateKey(env('NMI_MERCHANT_API_KEY'));
  if (!key || key === 'replace_me') {
    throw new Error(
      'No merchant key. On Merchants, Generate keys for a merchant, or set NMI_MERCHANT_API_KEY in nmi/.env.',
    );
  }
  return key;
}

function partnerKey() {
  const key = env('NMI_PARTNER_API_KEY');
  if (!key || key === 'replace_me') {
    throw new Error(
      'Set NMI_PARTNER_API_KEY in nmi/.env (Partner Portal → Partner Keys · v4_secret_…).',
    );
  }
  return key;
}

async function parseJsonResponse(res, label) {
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
      (Array.isArray(data.errors) ? JSON.stringify(data.errors) : null) ||
      `${label} failed (${res.status})`;
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/** Partner Account Management (v4) — Authorization is the partner key, not merchant key. */
async function partnerRest(method, pathName, body) {
  const res = await fetch(`${gatewayBase()}${pathName.startsWith('/') ? pathName : `/${pathName}`}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: partnerKey(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return parseJsonResponse(res, 'Partner API');
}

async function gatewayRest(method, pathName, body) {
  const res = await fetch(`${gatewayBase()}${pathName.startsWith('/') ? pathName : `/${pathName}`}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: merchantKey(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return parseJsonResponse(res, 'Gateway');
}

function tagValue(block, tag) {
  const hit = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return hit ? hit[1].trim() : null;
}

/** Parse nested &lt;action&gt; nodes from NMI Query API XML. */
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
      // NMI Query `condition` — original status (complete, failed, canceled, pendingsettlement, …)
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
      // NMI action-level fields (original)
      success: last.success ?? first.success ?? null,
      response_text: last.response_text || first.response_text || tagValue(block, 'responsetext'),
      response_code: last.response_code || first.response_code || null,
      actions,
    });
  }
  return rows;
}

export const signup = {
  listPackages: (query = {}) => signupFetch('GET', '/packages', { query }),
  getPackage: (id) => signupFetch('GET', `/packages/${encodeURIComponent(id)}`),
  listApplications: (query = {}) => signupFetch('GET', '/applications', { query }),
  getApplication: (id) => signupFetch('GET', `/applications/${encodeURIComponent(id)}`),
  createApplication: (body, idempotencyKey) =>
    signupFetch('POST', '/applications', {
      body,
      idempotencyKey: idempotencyKey || crypto.randomUUID(),
    }),
  updateApplication: (id, body, idempotencyKey) =>
    signupFetch('PATCH', `/applications/${encodeURIComponent(id)}`, {
      body,
      idempotencyKey: idempotencyKey || crypto.randomUUID(),
    }),
  getLegalConsent: (id) =>
    signupFetch('GET', `/applications/${encodeURIComponent(id)}/legal-consent`),
  submitApplication: (id, { skipMerchantEmail = false } = {}) =>
    signupFetch('POST', `/applications/${encodeURIComponent(id)}/submit`, {
      query: skipMerchantEmail ? { skip_merchant_email: 'true' } : undefined,
    }),
  /** Register Sign-Up webhook callback (needs subscriptions:write). */
  createSubscription: (body, idempotencyKey) =>
    signupFetch('POST', '/subscriptions', {
      body,
      idempotencyKey: idempotencyKey || crypto.randomUUID(),
    }),
};

/** Partner portal merchants (same list as sandbox.nmi.com/partners/accounts). */
export const partner = {
  listMerchants: (body = {}) =>
    partnerRest('POST', '/v4/merchants/reports', {
      maxResults: String(body.maxResults ?? 100),
      ...(body.search ? { search: body.search } : {}),
      ...(body.type ? { type: body.type } : {}),
      ...(body.offset != null && body.offset !== '' ? { offset: String(body.offset) } : {}),
      ...(Array.isArray(body.ids) && body.ids.length ? { ids: body.ids } : {}),
    }),
  createMerchant: (body) => partnerRest('POST', '/v4/merchants', body),
  /** Hard-delete merchant under partner (HTTP 204 on success). */
  deleteMerchant: (gatewayId) =>
    partnerRest('DELETE', `/v4/merchants/${encodeURIComponent(gatewayId)}`),
  /** Create merchant security key (transaction / tokenization / …). */
  createSecurityKey: (gatewayId, body) =>
    partnerRest('POST', `/v4/merchants/${encodeURIComponent(gatewayId)}/security_keys`, body),
};

export const gateway = {
  sale: (payload) => gatewayRest('POST', '/v5/payments/sale', payload),
  authorize: (payload) => gatewayRest('POST', '/v5/payments/auth', payload),
  capture: (id, payload = {}) =>
    gatewayRest('POST', `/v5/payments/${encodeURIComponent(id)}/capture`, payload),
  voidPayment: (id, payload = {}) =>
    gatewayRest('POST', `/v5/payments/${encodeURIComponent(id)}/void`, payload),
  refund: (id, payload = {}) =>
    gatewayRest('POST', `/v5/payments/${encodeURIComponent(id)}/refund`, payload),
  getPayment: (id) => gatewayRest('GET', `/v5/payments/${encodeURIComponent(id)}`),
  listCustomers: (query = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') qs.set(k, String(v));
    }
    const suffix = qs.toString() ? `?${qs}` : '';
    return gatewayRest('GET', `/v5/customers${suffix}`);
  },
  createCustomer: (payload) => gatewayRest('POST', '/v5/customers', payload),
  getCustomer: (id) => gatewayRest('GET', `/v5/customers/${encodeURIComponent(id)}`),
  async queryTransactions(params = {}) {
    // Classic query.php — also via Vite proxy
    const body = new URLSearchParams();
    body.set('security_key', merchantKey());
    body.set('report_type', params.report_type || 'transaction');
    if (params.transaction_id) body.set('transaction_id', params.transaction_id);
    if (params.start_date) body.set('start_date', params.start_date);
    if (params.end_date) body.set('end_date', params.end_date);
    if (params.condition) body.set('condition', params.condition);
    if (params.result_limit) body.set('result_limit', String(params.result_limit));

    const res = await fetch(`${gatewayBase()}/query.php`, {
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
    return { format: 'xml', raw: text, transactions: parseTransactionXml(text) };
  },
};
