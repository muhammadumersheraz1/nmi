/**
 * Sample backend for NMI docs features:
 * Sign-Up (partner OAuth) + Payments / Customers / Query (merchant API key).
 */
import http from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import { DOCS_CATALOG } from './docsCatalog.js';
import * as gateway from './gateway.js';
import {
  buildFormDraftFromPackage,
  buildPayloadFromPackage,
  draftToPayload,
  withMonthlyVolume,
} from './sampleFields.js';
import {
  createApplication,
  getApplication,
  getLegalConsent,
  getPackage,
  listApplications,
  listPackages,
  nmiConfigStatus,
  webhookConfigStatus,
  submitApplication,
  updateApplication,
  verifyWebhookSignature,
} from './nmi.js';

async function buildSamplePayload(packageId, monthlyVolume) {
  const pkg = await getPackage(packageId);
  const built = buildPayloadFromPackage(pkg, {
    monthlyVolume: monthlyVolume != null ? monthlyVolume : 6000,
  });
  return { ...built, package_detail: pkg };
}

const PORT = Number(process.env.NMI_API_PORT || 5191);
const webhookLog = [];

function uniqueRefId(prefix = 'ref') {
  return `${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

/** Processor dedupes card+amount; order id alone is not enough. Bump 1–99¢ unless exact_amount. */
function uniqueAmount(base, exact) {
  const n = Number(base);
  if (exact || !Number.isFinite(n)) return n;
  const cents = Math.round(n * 100);
  const bump = randomInt(1, 100);
  return Number(((cents + bump) / 100).toFixed(2));
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Signature, Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,OPTIONS',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return { raw: buf, json: {} };
  try {
    return { raw: buf, json: JSON.parse(buf.toString('utf8')) };
  } catch {
    const err = new Error('Invalid JSON body');
    err.status = 400;
    throw err;
  }
}

function match(path, pattern) {
  const a = path.split('/').filter(Boolean);
  const b = pattern.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < b.length; i++) {
    if (b[i].startsWith(':')) params[b[i].slice(1)] = decodeURIComponent(a[i]);
    else if (b[i] !== a[i]) return null;
  }
  return params;
}

/**
 * Sandbox merchants: NMI rejects sales when billing email ≠ account email
 * ("Sandbox accounts can only send emails to their own email address").
 * Prefer explicit request email, else NMI_SANDBOX_EMAIL; drop placeholders.
 */
function sandboxSafeEmail(requested) {
  const fromReq = String(requested || '').trim();
  const fromEnv = String(process.env.NMI_SANDBOX_EMAIL || '').trim();
  const candidate = fromReq || fromEnv;
  if (!candidate) return null;
  if (/@(example\.com|example\.org|test\.com)$/i.test(candidate)) return null;
  if (/^(shopper|customer|test)@/i.test(candidate) && !fromEnv) return null;
  return candidate;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  // Per-application gateway key (Customers / Transactions / Pay)
  gateway.enterMerchantKey(req.headers['x-nmi-merchant-key']);

  try {
    if (req.method === 'GET' && path === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'nmi-docs-sample',
        signup: nmiConfigStatus(),
        gateway: gateway.gatewayConfigStatus(),
        webhook: webhookConfigStatus(),
      });
      return;
    }

    if (req.method === 'GET' && path === '/api/docs-catalog') {
      sendJson(res, 200, { catalog: DOCS_CATALOG });
      return;
    }

    if (req.method === 'GET' && path === '/api/packages') {
      const data = await listPackages({
        page: url.searchParams.get('page') || undefined,
        per_page: url.searchParams.get('per_page') || undefined,
      });
      sendJson(res, 200, data);
      return;
    }

    let params = match(path, '/api/packages/:id/form');
    if (req.method === 'GET' && params) {
      const pkg = await getPackage(params.id);
      const monthly = url.searchParams.get('monthly_volume');
      const draft = buildFormDraftFromPackage(pkg, {
        monthlyVolume: monthly != null ? Number(monthly) : 6000,
      });
      sendJson(res, 200, {
        package: pkg,
        field_values: draft.fieldValues,
        collection_values: draft.collectionValues,
        package_rules: pkg.package_rules || [],
      });
      return;
    }

    params = match(path, '/api/packages/:id');
    if (req.method === 'GET' && params) {
      const data = await getPackage(params.id);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'GET' && path === '/api/applications') {
      const data = await listApplications({
        status: url.searchParams.get('status') || undefined,
        page: url.searchParams.get('page') || undefined,
      });
      sendJson(res, 200, data);
      return;
    }

    params = match(path, '/api/applications/:id');
    if (req.method === 'GET' && params) {
      const data = await getApplication(params.id);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && path === '/api/applications') {
      const { json } = await parseJson(req);
      const packageId = json.package_id || process.env.NMI_DEFAULT_PACKAGE_ID;
      if (!packageId) {
        sendJson(res, 400, {
          detail:
            'package_id is required. Load GET /api/packages and pick one from your NMI partner account.',
        });
        return;
      }
      let fields;
      let collections;
      if (json.field_values || json.collection_values) {
        const pkg = await getPackage(packageId);
        const built = draftToPayload(pkg, json.field_values || {}, json.collection_values || {});
        fields =
          json.monthly_volume != null
            ? withMonthlyVolume(built.fields, json.monthly_volume)
            : built.fields;
        collections = built.collections;
      } else if (json.use_sample || !Array.isArray(json.fields)) {
        const built = await buildSamplePayload(packageId, json.monthly_volume);
        fields = built.fields;
        collections = built.collections;
      } else {
        fields =
          json.monthly_volume != null
            ? withMonthlyVolume(json.fields, json.monthly_volume)
            : json.fields;
        collections = Array.isArray(json.collections)
          ? json.collections
          : (await buildSamplePayload(packageId, json.monthly_volume)).collections;
      }
      const data = await createApplication({
        package_id: packageId,
        fields,
        collections,
      });
      sendJson(res, 200, data);
      return;
    }

    // Patch an existing draft with sample data filtered to that app's package
    params = match(path, '/api/applications/:id/fill-sample');
    if (req.method === 'POST' && params) {
      const { json } = await parseJson(req).catch(() => ({ json: {} }));
      const app = await getApplication(params.id);
      const packageId =
        json.package_id || app.package_id || app.package?.id || process.env.NMI_DEFAULT_PACKAGE_ID;
      if (!packageId) {
        sendJson(res, 400, {
          detail: 'Could not resolve package_id for this application.',
        });
        return;
      }
      const built = await buildSamplePayload(packageId, json.monthly_volume);
      const data = await updateApplication(params.id, {
        fields: built.fields,
        collections: built.collections,
      });
      sendJson(res, 200, data);
      return;
    }

    params = match(path, '/api/applications/:id');
    if ((req.method === 'PUT' || req.method === 'PATCH') && params) {
      const { json } = await parseJson(req);
      const data = await updateApplication(params.id, {
        fields: json.fields,
        collections: json.collections,
      });
      sendJson(res, 200, data);
      return;
    }

    params = match(path, '/api/applications/:id/legal-consent');
    if (req.method === 'GET' && params) {
      const data = await getLegalConsent(params.id);
      sendJson(res, 200, data);
      return;
    }

    params = match(path, '/api/applications/:id/submit');
    if (req.method === 'POST' && params) {
      const { json } = await parseJson(req).catch(() => ({ json: {} }));
      const data = await submitApplication(params.id, {
        skipMerchantEmail: Boolean(json.skip_merchant_email),
      });
      sendJson(res, 200, data);
      return;
    }

    // —— Gateway payments (merchant API key) ——
    if (req.method === 'GET' && path === '/api/pay/test-cards') {
      sendJson(res, 200, gateway.TEST_CARDS);
      return;
    }

    if (req.method === 'POST' && path === '/api/pay/sale') {
      const { json } = await parseJson(req);
      const amount = uniqueAmount(json.amount, json.exact_amount);
      const billing_address = {
        first_name: json.first_name || 'John',
        last_name: json.last_name || 'Doe',
        address1: json.address1 || '888 Main St',
        city: json.city || 'New York',
        state: json.state || 'NY',
        zip: json.zip || '10001',
        country: json.country || 'US',
      };
      // Sandbox only allows receipt emails to the merchant's own address — omit
      // fake emails (shopper@example.com) or use NMI_SANDBOX_EMAIL from .env.
      const email = sandboxSafeEmail(json.email);
      if (email) billing_address.email = email;
      const refId = json.ref_id || json.order_id || uniqueRefId('sale');
      const payload = {
        amount,
        currency: (json.currency || 'USD').toUpperCase(),
        order_details: {
          id: refId,
          description: json.order_description || `Sale ${refId}`,
        },
        payment_details: {
          card_number: String(json.card_number || '').replace(/\s+/g, ''),
          card_exp: String(json.card_exp || '').replace(/\D/g, ''),
          card_cvv: String(json.card_cvv || ''),
        },
        billing_address,
      };
      if (json.dup_seconds != null) payload.dup_seconds = Number(json.dup_seconds);
      if (json.add_to_vault) {
        payload.customer_vault = {
          add_to_vault: true,
          id: json.customer_vault_id || undefined,
        };
      }
      const data = await gateway.sale(payload);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && path === '/api/pay/auth') {
      const { json } = await parseJson(req);
      const billing_address = {
        first_name: json.first_name || 'John',
        last_name: json.last_name || 'Doe',
      };
      const email = sandboxSafeEmail(json.email);
      if (email) billing_address.email = email;
      const refId = json.ref_id || json.order_id || uniqueRefId('auth');
      const authPayload = {
        amount: uniqueAmount(json.amount, json.exact_amount),
        currency: (json.currency || 'USD').toUpperCase(),
        order_details: {
          id: refId,
          description: json.order_description || `Auth ${refId}`,
        },
        payment_details: {
          card_number: String(json.card_number || '').replace(/\s+/g, ''),
          card_exp: String(json.card_exp || '').replace(/\D/g, ''),
          card_cvv: String(json.card_cvv || ''),
        },
        billing_address,
      };
      if (json.dup_seconds != null) authPayload.dup_seconds = Number(json.dup_seconds);
      const data = await gateway.authorize(authPayload);
      sendJson(res, 200, data);
      return;
    }

    params = match(path, '/api/pay/:id/capture');
    if (req.method === 'POST' && params) {
      const { json } = await parseJson(req).catch(() => ({ json: {} }));
      const data = await gateway.capture(params.id, json.amount != null ? { amount: Number(json.amount) } : {});
      sendJson(res, 200, data);
      return;
    }

    params = match(path, '/api/pay/:id/void');
    if (req.method === 'POST' && params) {
      const data = await gateway.voidPayment(params.id, {});
      sendJson(res, 200, data);
      return;
    }

    params = match(path, '/api/pay/:id/refund');
    if (req.method === 'POST' && params) {
      const { json } = await parseJson(req).catch(() => ({ json: {} }));
      const data = await gateway.refund(
        params.id,
        json.amount != null ? { amount: Number(json.amount) } : {},
      );
      sendJson(res, 200, data);
      return;
    }

    params = match(path, '/api/pay/:id');
    if (req.method === 'GET' && params) {
      const data = await gateway.getPayment(params.id);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'GET' && path === '/api/transactions') {
      const data = await gateway.queryTransactions({
        report_type: url.searchParams.get('report_type') || 'transaction',
        transaction_id: url.searchParams.get('transaction_id') || undefined,
        start_date: url.searchParams.get('start_date') || undefined,
        end_date: url.searchParams.get('end_date') || undefined,
        condition: url.searchParams.get('condition') || undefined,
        result_limit: url.searchParams.get('result_limit') || '50',
      });
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'GET' && path === '/api/customers') {
      const data = await gateway.listCustomers({
        limit: url.searchParams.get('limit') || undefined,
      });
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'POST' && path === '/api/customers') {
      const { json } = await parseJson(req);
      const billingIn = json.billing || {};
      const cardNumber = String(
        billingIn.payment_details?.card_number || json.card_number || '',
      ).replace(/\s+/g, '');
      const cardExp = String(billingIn.payment_details?.card_exp || json.card_exp || '').replace(
        /\D/g,
        '',
      );
      if (!cardNumber || !cardExp) {
        sendJson(res, 400, {
          detail:
            'Create customer requires billing.payment_details.card_number + card_exp (NMI vault always stores a payment method).',
        });
        return;
      }
      const billing = {
        first_name: billingIn.first_name || json.first_name || 'Jane',
        last_name: billingIn.last_name || json.last_name || 'Shopper',
        payment_details: { card_number: cardNumber, card_exp: cardExp },
      };
      const email = sandboxSafeEmail(billingIn.email || json.email);
      if (email) billing.email = email;
      if (billingIn.address1 || json.address1) {
        billing.address1 = billingIn.address1 || json.address1;
      }
      if (billingIn.zip || json.zip) billing.zip = billingIn.zip || json.zip;
      const data = await gateway.createCustomer({ billing });
      sendJson(res, 200, data);
      return;
    }

    params = match(path, '/api/customers/:id');
    if (req.method === 'GET' && params) {
      const data = await gateway.getCustomer(params.id);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === 'GET' && path === '/api/webhooks/log') {
      sendJson(res, 200, { events: webhookLog.slice(-50) });
      return;
    }

    if (req.method === 'POST' && path === '/api/webhooks/nmi') {
      const raw = await readBody(req);
      const signature = req.headers.signature || req.headers['x-nmi-signature'] || '';
      const verify = verifyWebhookSignature(raw, signature);
      let payload = {};
      try {
        payload = JSON.parse(raw.toString('utf8') || '{}');
      } catch {
        payload = { raw: raw.toString('utf8') };
      }
      const entry = {
        at: new Date().toISOString(),
        verified: verify.ok,
        verify_reason: verify.reason,
        event_type: payload.event_type || null,
        event_id: payload.event_id || null,
        body: payload,
      };
      webhookLog.push(entry);
      if (webhookLog.length > 100) webhookLog.shift();
      // Always 200 so NMI does not retry forever during local demos without secret.
      sendJson(res, 200, { received: true, verified: verify.ok });
      return;
    }

    sendJson(res, 404, { detail: 'Not found' });
  } catch (err) {
    const status = err.status || 500;
    sendJson(res, status, {
      detail: err.message || 'Server error',
      body: err.body || undefined,
    });
  }
});

server.listen(PORT, () => {
  console.log(`NMI docs sample API → http://127.0.0.1:${PORT}`);
  console.log(`Sign-Up:`, nmiConfigStatus());
  console.log(`Gateway:`, gateway.gatewayConfigStatus());
  const wh = webhookConfigStatus();
  console.log(`Webhook:`, wh);
  if (wh.public_url) {
    console.log(`  NMI portal URL:  ${wh.full_url}`);
    console.log(`  webhook.cool →   ${wh.local_url}`);
  }
});
