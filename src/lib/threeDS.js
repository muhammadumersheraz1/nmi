/**
 * NMI sandbox Payer Authentication (3DS) via Gateway.js.
 * Docs: https://docs.nmi.com/docs/payer-authentication-3ds
 * Sandbox cards: https://docs.nmi.com/docs/testing-sandbox
 * Cardinal createUI cards (test-mode): https://docs.nmi.com/docs/testing
 */
import { getActiveMerchant, maskKey, resolvePublicKey } from './merchantSession.js';

const GATEWAY_JS_SRC = 'https://sandbox.nmi.com/js/v1/Gateway.js';
const DEFAULT_MOUNT_ID = 'nmi-threeds-mount';
/** Sandbox 3DS can hang if complete never fires — unlock the UI. */
const AUTH_TIMEOUT_MS = 90_000;
const LOG = (...args) => console.log('[nmi:3ds]', ...args);
const LOG_WARN = (...args) => console.warn('[nmi:3ds]', ...args);
const LOG_ERR = (...args) => console.error('[nmi:3ds]', ...args);

/** Shared 2D / sandbox sale defaults. */
export const SANDBOX_SUCCESS = {
  card_exp: '1029',
  card_cvv: '999',
  amount: 10.0,
  currency: 'USD',
};

/** Cardinal / Gateway.js test-mode defaults (secure.nmi.com test mode). */
export const SANDBOX_3DS_CARDINAL = {
  card_exp: '0830',
  card_cvv: '999',
  challenge_password: '1234',
};

export const TEST_CARDS_2D = [
  {
    id: 'visa-plain',
    label: '2D · Visa success',
    card_number: '4111111111111111',
    card_exp: SANDBOX_SUCCESS.card_exp,
    card_cvv: SANDBOX_SUCCESS.card_cvv,
    note: 'Approved sale — auto-fills exp/CVV',
    outcome: 'success',
  },
  {
    id: 'mc-plain',
    label: '2D · Mastercard success',
    card_number: '5431111111111111',
    card_exp: SANDBOX_SUCCESS.card_exp,
    card_cvv: SANDBOX_SUCCESS.card_cvv,
    note: 'Approved sale — auto-fills exp/CVV',
    outcome: 'success',
  },
];

/**
 * Primary: sandbox.nmi.com Gateway.js cards (testing-sandbox).
 * These previously completed successfully on this sample.
 */
export const TEST_CARDS_3D = [
  {
    id: 'sbx-visa-frictionless',
    label: '3D · Visa frictionless (sandbox)',
    card_number: '4100000000000100',
    card_exp: SANDBOX_SUCCESS.card_exp,
    card_cvv: SANDBOX_SUCCESS.card_cvv,
    note: 'sandbox.nmi.com — silent verified; challenge code N/A',
    outcome: 'success',
    family: 'sandbox',
  },
  {
    id: 'sbx-visa-challenge',
    label: '3D · Visa challenge (sandbox)',
    card_number: '4100000000005000',
    card_exp: SANDBOX_SUCCESS.card_exp,
    card_cvv: SANDBOX_SUCCESS.card_cvv,
    note: 'sandbox.nmi.com — enter 12345 to pass',
    outcome: 'success',
    family: 'sandbox',
    challenge: true,
  },
  {
    id: 'sbx-visa-bypass',
    label: '3D · Visa bypassed (sandbox)',
    card_number: '4100000000300005',
    card_exp: SANDBOX_SUCCESS.card_exp,
    card_cvv: SANDBOX_SUCCESS.card_cvv,
    note: 'sandbox.nmi.com — bypassed auth',
    outcome: 'success',
    family: 'sandbox',
  },
  {
    id: 'sbx-mc-frictionless',
    label: '3D · Mastercard frictionless (sandbox)',
    card_number: '5100000000000107',
    card_exp: SANDBOX_SUCCESS.card_exp,
    card_cvv: SANDBOX_SUCCESS.card_cvv,
    note: 'sandbox.nmi.com — silent verified',
    outcome: 'success',
    family: 'sandbox',
  },
  {
    id: 'sbx-mc-challenge',
    label: '3D · Mastercard challenge (sandbox)',
    card_number: '5100000000005007',
    card_exp: SANDBOX_SUCCESS.card_exp,
    card_cvv: SANDBOX_SUCCESS.card_cvv,
    note: 'sandbox.nmi.com — enter 12345 to pass',
    outcome: 'success',
    family: 'sandbox',
    challenge: true,
  },
  {
    id: 'cardinal-frictionless',
    label: '3D · Cardinal frictionless (test-mode)',
    card_number: '4000000000002701',
    card_exp: SANDBOX_3DS_CARDINAL.card_exp,
    card_cvv: SANDBOX_3DS_CARDINAL.card_cvv,
    note: 'docs/testing — use if sandbox list is rejected; password N/A',
    outcome: 'success',
    family: 'cardinal',
  },
  {
    id: 'cardinal-stepup',
    label: '3D · Cardinal challenge (test-mode)',
    card_number: '4000000000002503',
    card_exp: SANDBOX_3DS_CARDINAL.card_exp,
    card_cvv: SANDBOX_3DS_CARDINAL.card_cvv,
    note: 'docs/testing — password 1234',
    outcome: 'success',
    family: 'cardinal',
    challenge: true,
  },
];

const KNOWN_3DS_PANS = new Set(TEST_CARDS_3D.map((c) => c.card_number));

/** Apply preset card fields onto a pay form. */
export function applyTestCardFields(form, preset) {
  const p = preset || {};
  return {
    ...form,
    card_number: p.card_number || form.card_number,
    card_exp: p.card_exp || SANDBOX_SUCCESS.card_exp,
    card_cvv: p.card_cvv || SANDBOX_SUCCESS.card_cvv,
    amount: form.amount ?? SANDBOX_SUCCESS.amount,
    currency: form.currency || SANDBOX_SUCCESS.currency,
  };
}

function env(name, fallback = '') {
  const v = import.meta.env[name];
  return v == null || v === '' ? fallback : String(v);
}

export function publicApiKey() {
  const key = resolvePublicKey(env('NMI_PUBLIC_API_KEY') || env('NMI_TOKENIZATION_KEY'));
  if (!key || key === 'replace_me') {
    throw new Error(
      'No public (collectCheckout) key. On Merchants click Regen keys, or set NMI_PUBLIC_API_KEY.',
    );
  }
  return key;
}

export function publicKeyConfigured() {
  try {
    publicApiKey();
    return true;
  } catch {
    return false;
  }
}

let loadPromise = null;

export function loadGatewayJs() {
  if (typeof window !== 'undefined' && window.Gateway) {
    LOG('Gateway.js already on window');
    return Promise.resolve(window.Gateway);
  }
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GATEWAY_JS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Gateway));
      existing.addEventListener('error', () => reject(new Error('Failed to load Gateway.js')));
      if (window.Gateway) resolve(window.Gateway);
      return;
    }
    LOG('Loading Gateway.js', GATEWAY_JS_SRC);
    const script = document.createElement('script');
    script.src = GATEWAY_JS_SRC;
    script.async = true;
    script.onload = () => {
      if (!window.Gateway) {
        reject(new Error('Gateway.js loaded but Gateway is undefined'));
        return;
      }
      LOG('Gateway.js loaded OK');
      resolve(window.Gateway);
    };
    script.onerror = () => reject(new Error('Failed to load sandbox Gateway.js'));
    document.head.appendChild(script);
  });
  return loadPromise;
}

function parseExp(cardExp) {
  const digits = String(cardExp || '').replace(/\D/g, '');
  if (digits.length < 4) throw new Error('Card exp must be MMYY');
  const month = digits.slice(0, 2);
  let year = digits.slice(2);
  if (year.length === 2) year = `20${year}`;
  return { month, year };
}

function resolveMountSelector(mount) {
  if (typeof mount === 'string') {
    if (!document.querySelector(mount)) {
      throw new Error(`3DS mount not found: ${mount}`);
    }
    return mount;
  }
  if (mount && mount.nodeType === 1) {
    if (!mount.id) mount.id = DEFAULT_MOUNT_ID;
    return `#${CSS.escape(mount.id)}`;
  }
  throw new Error('3DS mount must be a selector string or HTMLElement');
}

function eventMessage(e) {
  if (!e) return 'unknown error';
  if (typeof e === 'string') return e;
  return (
    e.message ||
    e.error?.message ||
    e.error ||
    e.code ||
    (typeof e.toString === 'function' ? e.toString() : JSON.stringify(e))
  );
}

function extractChallengeUrl(e, mountEl, cardNumber) {
  const candidates = [
    e?.iframeUrl,
    e?.acsUrl,
    e?.AcsUrl,
    e?.url,
    e?.challengeUrl,
    e?.data?.iframeUrl,
    e?.data?.AcsUrl,
    e?.data?.acsUrl,
  ].filter(Boolean);
  if (candidates[0]) return String(candidates[0]);
  const iframe = mountEl?.querySelector?.('iframe[src]');
  if (iframe?.src) return iframe.src;
  if (cardNumber) {
    return `https://sandbox.nmi.com/gatewayjs/v1/threeDS/mock-challenge.php?card=${encodeURIComponent(cardNumber)}&t=${Math.floor(Date.now() / 1000)}`;
  }
  return null;
}

function openChallengeInNewTab(url) {
  if (!url) return null;
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  LOG('opened challenge in new tab', url, win ? 'ok' : 'blocked');
  return win;
}

/**
 * Run Gateway.js 3DS UI, resolve with REST v5 cardholder_auth fields.
 */
export async function authenticate3DS({ mount, form, onPhase, signal } = {}) {
  const Gateway = await loadGatewayJs();
  const key = publicApiKey();
  const active = getActiveMerchant();
  const { month, year } = parseExp(form.card_exp);
  const amount = Number(form.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid amount');

  const cardNumber = String(form.card_number || '').replace(/\s+/g, '');
  if (!KNOWN_3DS_PANS.has(cardNumber)) {
    LOG_WARN(
      'PAN not in known 3DS allowlist — Gateway.js may reject it',
      cardNumber.slice(0, 6) + '…',
      'known:',
      [...KNOWN_3DS_PANS],
    );
  }

  const selector = resolveMountSelector(mount);
  const mountEl = document.querySelector(selector);
  if (mountEl) mountEl.innerHTML = '';

  const email =
    String(form.email || '').trim() ||
    env('NMI_SANDBOX_EMAIL') ||
    'none@example.com';

  // Only documented createUI fields — unknown keys (e.g. cartCorrelationId) throw.
  const options = {
    cardNumber,
    cardExpMonth: month,
    cardExpYear: year,
    currency: String(form.currency || 'USD').toUpperCase(),
    amount: amount.toFixed(2),
    firstName: form.first_name || 'John',
    lastName: form.last_name || 'Doe',
    email,
    phone: form.phone || '8008675309',
    address1: form.address1 || '888 Main St',
    city: form.city || 'New York',
    state: form.state || 'NY',
    country: form.country || 'US',
    postalCode: form.zip || form.postal_code || '10001',
  };

  LOG('start', {
    merchantId: active?.merchantId || null,
    publicKey: maskKey(key),
    publicKeySource: active?.publicKey ? 'session(merchant)' : 'env',
    selector,
    pan: `${cardNumber.slice(0, 6)}…${cardNumber.slice(-4)}`,
    panKnown: KNOWN_3DS_PANS.has(cardNumber),
    cardExpMonth: options.cardExpMonth,
    cardExpYear: options.cardExpYear,
    amount: options.amount,
    currency: options.currency,
    email: options.email,
  });

  const gateway = Gateway.create(key);
  const threeDS = gateway.get3DSecure();
  LOG('Gateway.create + get3DSecure OK (init.php should show 3DSecure active)');

  const ui = threeDS.createUI(options);
  LOG('createUI OK');

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      try {
        signal?.removeEventListener?.('abort', onAbort);
      } catch {
        /* ignore */
      }
      try {
        ui?.unmount?.();
      } catch {
        /* ignore */
      }
      try {
        ui?.close?.();
      } catch {
        /* ignore */
      }
      try {
        if (mountEl) mountEl.innerHTML = '';
      } catch {
        /* ignore */
      }
    };

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };

    const onAbort = () => {
      LOG('aborted by user');
      finish(reject, new Error('3DS cancelled'));
    };

    timer = setTimeout(() => {
      LOG_ERR('timeout after', AUTH_TIMEOUT_MS, 'ms');
      finish(
        reject,
        new Error(
          '3DS timed out (90s). Prefer sandbox cards 4100000000000100 (frictionless) or 4100000000005000 + code 12345. Regen keys with collectCheckout, then retry.',
        ),
      );
    }, AUTH_TIMEOUT_MS);

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort);
    }

    gateway.on('error', (e) => {
      LOG_ERR('gateway error', e);
      onPhase?.('error', e);
      const msg = eventMessage(e);
      finish(
        reject,
        new Error(
          /supported test card/i.test(msg)
            ? `${msg} — try sandbox PAN 4100000000000100 (exp 1029) or Cardinal 4000000000002701 (exp 0830). Regen keys (collectCheckout). Check console [nmi:3ds].`
            : msg || 'Gateway.js 3DS error',
        ),
      );
    });

    ui.on('error', (e) => {
      LOG_ERR('ui error', e);
      onPhase?.('error', e);
      const msg = eventMessage(e);
      finish(
        reject,
        new Error(
          /supported test card/i.test(msg)
            ? `${msg} — try 4100000000000100 / 1029 / 999. See console [nmi:3ds] for the PAN sent.`
            : msg || '3DS UI error',
        ),
      );
    });

    ui.on('challenge', (e) => {
      LOG('challenge', e);
      // Prefer the iframe Gateway.js already mounted (same session); else event / mock URL
      const openUrl = () => {
        const url = extractChallengeUrl(e, mountEl, cardNumber);
        if (url) {
          openChallengeInNewTab(url);
          onPhase?.('challenge', { ...(e && typeof e === 'object' ? e : {}), challengeUrl: url });
        } else {
          onPhase?.('challenge', e);
        }
      };
      // Give Gateway.js a tick to inject the challenge iframe, then open that src
      requestAnimationFrame(() => setTimeout(openUrl, 50));
    });

    ui.on('failure', (e) => {
      LOG_WARN('failure', e);
      onPhase?.('failure', e);
      finish(reject, new Error(eventMessage(e) || '3DS authentication failed'));
    });

    ui.on('complete', (e) => {
      LOG('complete', e);
      onPhase?.('complete', e);
      const statusRaw = String(e.cardHolderAuth || e.cardholder_auth || '').toLowerCase();
      const status = statusRaw === 'verified' || statusRaw === 'attempted' ? statusRaw : 'verified';
      const cardholder_auth = {
        status,
        cavv: e.cavv || '',
        xid: e.xid || undefined,
        three_ds_version: e.threeDsVersion || e.three_ds_version || undefined,
        directory_server_id: e.directoryServerId || e.directory_server_id || undefined,
      };
      finish(resolve, {
        cardholder_auth,
        eci: e.eci,
        cardholder_info: e.cardHolderInfo || e.cardholder_info || null,
        raw: e,
      });
    });

    try {
      LOG('ui.start', selector);
      ui.start(selector);
      onPhase?.('started');
    } catch (err) {
      LOG_ERR('ui.start threw', err);
      finish(reject, err instanceof Error ? err : new Error(String(err)));
    }
  });
}
