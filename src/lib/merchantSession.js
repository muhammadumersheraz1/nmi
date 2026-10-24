/**
 * Per-merchant security keys for the sandbox sample (sessionStorage).
 * Generated via Partner POST /v4/merchants/{id}/security_keys.
 */

const STORE_KEY = 'nmi_merchant_key_vault';
const ACTIVE_KEY = 'nmi_active_merchant_id';

function readVault() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeVault(vault) {
  sessionStorage.setItem(STORE_KEY, JSON.stringify(vault));
}

export function getMerchantKeys(merchantId) {
  if (!merchantId) return null;
  return readVault()[String(merchantId)] || null;
}

export function hasMerchantKeys(merchantId) {
  const row = getMerchantKeys(merchantId);
  return Boolean(row?.privateKey);
}

export function listMerchantsWithKeys() {
  return Object.values(readVault());
}

export function saveMerchantKeys(merchantId, payload) {
  const id = String(merchantId);
  const vault = readVault();
  vault[id] = {
    merchantId: id,
    company: payload.company || vault[id]?.company || '',
    privateKey: payload.privateKey || vault[id]?.privateKey || '',
    publicKey: payload.publicKey || vault[id]?.publicKey || '',
    privateKeyId: payload.privateKeyId || vault[id]?.privateKeyId || null,
    publicKeyId: payload.publicKeyId || vault[id]?.publicKeyId || null,
    updatedAt: new Date().toISOString(),
  };
  writeVault(vault);
  return vault[id];
}

export function clearMerchantKeys(merchantId) {
  const vault = readVault();
  delete vault[String(merchantId)];
  writeVault(vault);
  if (getActiveMerchantId() === String(merchantId)) {
    sessionStorage.removeItem(ACTIVE_KEY);
  }
}

export function setActiveMerchantId(merchantId) {
  if (!merchantId) {
    sessionStorage.removeItem(ACTIVE_KEY);
    return;
  }
  sessionStorage.setItem(ACTIVE_KEY, String(merchantId));
}

export function getActiveMerchantId() {
  return sessionStorage.getItem(ACTIVE_KEY) || null;
}

export function getActiveMerchant() {
  const id = getActiveMerchantId();
  if (!id) return null;
  return getMerchantKeys(id);
}

export function activateMerchant(merchantId) {
  const row = getMerchantKeys(merchantId);
  if (!row?.privateKey) {
    throw new Error('Generate merchant keys first on the Merchants tab.');
  }
  setActiveMerchantId(merchantId);
  return row;
}

/** Private key for gateway Pay / Query / Customers (active merchant, else .env). */
export function resolvePrivateKey(envFallback = '') {
  const active = getActiveMerchant();
  if (active?.privateKey) return active.privateKey;
  return envFallback || '';
}

/** Public / tokenization key for Gateway.js 3DS. */
export function resolvePublicKey(envFallback = '') {
  const active = getActiveMerchant();
  if (active?.publicKey) return active.publicKey;
  return envFallback || '';
}

export function maskKey(key) {
  const s = String(key || '');
  if (s.length <= 8) return s ? '••••' : '';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
