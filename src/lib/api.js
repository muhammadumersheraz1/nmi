/**
 * App API facade — calls NMI from the browser (no local Node backend).
 * Sign-Up requests hit sandbox.signup.nmi.com (see Network tab).
 */
import { configStatus, gateway, partner, signup } from './nmiClient.js';
import {
  buildFormDraftFromPackage,
  buildPayloadFromPackage,
  draftToPayload,
  withMonthlyVolume,
} from './sampleFields.js';

function errMsg(err) {
  if (err?.body) {
    const b = err.body;
    if (b.message || b.detail) return b.message || b.detail;
  }
  return err?.message || 'Request failed';
}

async function wrap(fn) {
  try {
    return await fn();
  } catch (err) {
    const e = new Error(errMsg(err));
    e.status = err.status;
    e.body = err.body;
    throw e;
  }
}

export const health = async () => configStatus();
export const docsCatalog = async () => {
  const { DOCS_CATALOG } = await import('./docsCatalog.js');
  return { catalog: DOCS_CATALOG };
};

export const listPackages = () => wrap(() => signup.listPackages());
export const getPackage = (id) => wrap(() => signup.getPackage(id));

export async function getPackageForm(id, monthlyVolume) {
  return wrap(async () => {
    const pkg = await signup.getPackage(id);
    const draft = buildFormDraftFromPackage(pkg, { monthlyVolume });
    return {
      package_id: pkg.id,
      field_values: draft.fieldValues,
      collection_values: draft.collectionValues,
      package_detail: pkg,
      rules: pkg.rules || [],
    };
  });
}

export const listApplications = (status) =>
  wrap(() => signup.listApplications(status ? { status } : {}));
export const getApplication = (id) => wrap(() => signup.getApplication(id));

export async function createApplication(body) {
  return wrap(async () => {
    const packageId = body.package_id || import.meta.env.NMI_DEFAULT_PACKAGE_ID;
    if (!packageId) throw new Error('package_id is required');

    let fields;
    let collections;
    if (body.field_values || body.collection_values) {
      const pkg = await signup.getPackage(packageId);
      const built = draftToPayload(pkg, body.field_values || {}, body.collection_values || {});
      fields =
        body.monthly_volume != null
          ? withMonthlyVolume(built.fields, body.monthly_volume)
          : built.fields;
      collections = built.collections;
    } else if (body.use_sample || !Array.isArray(body.fields)) {
      const pkg = await signup.getPackage(packageId);
      const built = buildPayloadFromPackage(pkg, { monthlyVolume: body.monthly_volume });
      fields = built.fields;
      collections = built.collections;
    } else {
      fields =
        body.monthly_volume != null
          ? withMonthlyVolume(body.fields, body.monthly_volume)
          : body.fields;
      collections = body.collections || [];
    }

    return signup.createApplication({
      package_id: packageId,
      fields,
      collections,
    });
  });
}

export async function fillSampleApplication(id, body = {}) {
  return wrap(async () => {
    const app = await signup.getApplication(id);
    const packageId =
      body.package_id || app.package_id || app.package?.id || import.meta.env.NMI_DEFAULT_PACKAGE_ID;
    if (!packageId) throw new Error('Could not resolve package_id');
    const pkg = await signup.getPackage(packageId);
    const built = buildPayloadFromPackage(pkg, { monthlyVolume: body.monthly_volume });
    return signup.updateApplication(id, {
      fields: built.fields,
      collections: built.collections,
    });
  });
}

export const getLegalConsent = (id) => wrap(() => signup.getLegalConsent(id));
export const submitApplication = (id, body = {}) =>
  wrap(() =>
    signup.submitApplication(id, { skipMerchantEmail: Boolean(body.skip_merchant_email) }),
  );

export const webhookLog = async () => ({ events: [] });

const SIGNUP_WEBHOOK_EVENTS = [
  'application.updated.data.requested',
  'application.approved',
  'application.declined',
  'application.cancelled',
  'application.merchant.boarded',
  'application.merchant.closed',
];

/** Register NMI_WEBHOOK_PUBLIC_URL with Sign-Up POST /subscriptions. */
export const registerWebhookSubscription = (body = {}) =>
  wrap(async () => {
    const callback_url = (
      body.callback_url ||
      import.meta.env.NMI_WEBHOOK_PUBLIC_URL ||
      ''
    ).replace(/\/$/, '');
    if (!callback_url) {
      throw new Error('Set NMI_WEBHOOK_PUBLIC_URL in nmi/.env (e.g. https://….webhook.cool)');
    }
    const secret =
      body.secret || import.meta.env.NMI_WEBHOOK_SECRET || crypto.randomUUID().replace(/-/g, '');
    if (String(secret).length < 6) {
      throw new Error('NMI_WEBHOOK_SECRET must be 6–64 characters');
    }
    return signup.createSubscription({
      callback_url,
      secret,
      events: body.events || SIGNUP_WEBHOOK_EVENTS,
    });
  });

/** Unique merchant reference per attempt. */
function uniqueRefId(prefix = 'ref') {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * This processor rejects dup_seconds:0 and still dedupes on card+amount
 * (order_details.id alone is not enough). Bump by 1–99¢ so sandbox retries work.
 * Pass exact_amount: true to skip the bump.
 */
function uniqueAmount(base, exact) {
  const n = Number(base);
  if (exact || !Number.isFinite(n)) return n;
  const cents = Math.round(n * 100);
  const bump = (crypto.getRandomValues(new Uint8Array(1))[0] % 99) + 1;
  return Number(((cents + bump) / 100).toFixed(2));
}

function buildPayPayload(body, kind) {
  const billing_address = {
    first_name: body.first_name || 'John',
    last_name: body.last_name || 'Doe',
    address1: body.address1 || '888 Main St',
    city: body.city || 'New York',
    state: body.state || 'NY',
    zip: body.zip || '10001',
    country: body.country || 'US',
  };
  const email = String(body.email || '').trim();
  if (email) billing_address.email = email;
  const refId = body.ref_id || body.order_id || uniqueRefId(kind);
  const payload = {
    amount: uniqueAmount(body.amount, body.exact_amount),
    currency: (body.currency || 'USD').toUpperCase(),
    order_details: {
      id: refId,
      description: body.order_description || `${kind === 'auth' ? 'Auth' : 'Sale'} ${refId}`,
    },
    payment_details: {
      card_number: String(body.card_number || '').replace(/\s+/g, ''),
      card_exp: String(body.card_exp || '').replace(/\D/g, ''),
      card_cvv: String(body.card_cvv || ''),
    },
    billing_address,
  };
  if (body.dup_seconds != null) payload.dup_seconds = Number(body.dup_seconds);
  if (body.add_to_vault) {
    payload.customer_vault = { add_to_vault: true, id: body.customer_vault_id || undefined };
  }
  // 3DS result from Gateway.js → REST v5 CardholderAuth
  if (body.cardholder_auth && typeof body.cardholder_auth === 'object') {
    payload.cardholder_auth = body.cardholder_auth;
  }
  return payload;
}

export const paySale = (body) => wrap(async () => gateway.sale(buildPayPayload(body, 'sale')));

export const payAuth = (body) => wrap(async () => gateway.authorize(buildPayPayload(body, 'auth')));

export const payCapture = (id, body = {}) =>
  wrap(() => gateway.capture(id, body.amount != null ? { amount: Number(body.amount) } : {}));
export const payVoid = (id) => wrap(() => gateway.voidPayment(id, {}));
export const payRefund = (id, body = {}) =>
  wrap(() => gateway.refund(id, body.amount != null ? { amount: Number(body.amount) } : {}));
export const getPayment = (id) => wrap(() => gateway.getPayment(id));

export const listTransactions = (query = {}) => wrap(() => gateway.queryTransactions(query));
export const listCustomers = () => wrap(() => gateway.listCustomers());
export const createCustomer = (body) => wrap(() => gateway.createCustomer(body));
export const getCustomer = (id) => wrap(() => gateway.getCustomer(id));

/** Partner Account Management — list / create / delete merchants under your partner. */
export const listPartnerMerchants = (body = {}) => wrap(() => partner.listMerchants(body));
export const createPartnerMerchant = (body) => wrap(() => partner.createMerchant(body));
export const deletePartnerMerchant = (gatewayId) =>
  wrap(() => partner.deleteMerchant(gatewayId));

export const createMerchantSecurityKey = (gatewayId, body) =>
  wrap(() => partner.createSecurityKey(gatewayId, body));

/** Generate private (transaction) + public (tokenization) keys for a merchant. */
export async function generateMerchantKeys(merchant, { descriptionPrefix = 'one9 sample' } = {}) {
  const id = merchant?.id || merchant?.merchantId;
  if (!id) throw new Error('merchant id required');
  const stamp = Date.now().toString(36).slice(-4);
  const privateRes = await createMerchantSecurityKey(id, {
    description: `${descriptionPrefix} api ${stamp}`,
    permissions: ['transaction'],
  });
  // Gateway.js needs collectCheckout; NMI also requires tokenization on that key.
  let publicRes = null;
  try {
    publicRes = await createMerchantSecurityKey(id, {
      description: `${descriptionPrefix} checkout ${stamp}`,
      permissions: ['collectCheckout', 'tokenization'],
    });
  } catch (checkoutErr) {
    try {
      publicRes = await createMerchantSecurityKey(id, {
        description: `${descriptionPrefix} public ${stamp}`,
        permissions: ['tokenization'],
      });
    } catch {
      // Private key alone is enough for 2D pay; 3DS needs a public checkout/tokenization key.
      console.warn('[nmi] public key create failed', checkoutErr);
    }
  }
  const { saveMerchantKeys, activateMerchant } = await import('./merchantSession.js');
  const saved = saveMerchantKeys(id, {
    company: merchant.company || '',
    privateKey: privateRes.keyText || privateRes.key || '',
    privateKeyId: privateRes.id || null,
    publicKey: publicRes?.keyText || publicRes?.key || '',
    publicKeyId: publicRes?.id || null,
  });
  if (!saved.privateKey) throw new Error('NMI did not return keyText for the private key');
  activateMerchant(id);
  return saved;
}

export const TERMINAL_STATUSES = new Set([
  'approved',
  'declined',
  'cancelled',
  'canceled',
  'boarded',
  'merchant_boarded',
  'underwriter_requested_information',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollApplicationUntil(
  id,
  { intervalMs = 2500, maxAttempts = 24, until = TERMINAL_STATUSES, onPoll, signal } = {},
) {
  let polls = 0;
  let application = await getApplication(id);
  polls += 1;
  onPoll?.({ application, polls });

  while (polls < maxAttempts) {
    const status = String(application.status || '').toLowerCase();
    if (until.has(status)) return { application, polls, timedOut: false };
    if (signal?.aborted) return { application, polls, timedOut: false };
    await sleep(intervalMs);
    if (signal?.aborted) return { application, polls, timedOut: false };
    application = await getApplication(id);
    polls += 1;
    onPoll?.({ application, polls });
  }
  return { application, polls, timedOut: true };
}
