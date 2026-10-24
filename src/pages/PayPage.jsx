import { useEffect, useMemo, useRef, useState } from 'react';
import ActiveMerchantBanner from '../components/ActiveMerchantBanner.jsx';
import * as api from '../lib/api.js';
import { getActiveMerchant, maskKey } from '../lib/merchantSession.js';
import {
  SANDBOX_SUCCESS,
  TEST_CARDS_2D,
  TEST_CARDS_3D,
  applyTestCardFields,
  authenticate3DS,
  publicKeyConfigured,
} from '../lib/threeDS.js';

const DEFAULT = applyTestCardFields(
  {
    amount: SANDBOX_SUCCESS.amount,
    currency: SANDBOX_SUCCESS.currency,
    first_name: 'John',
    last_name: 'Doe',
    email: '',
    address1: '888 Main St',
    city: 'New York',
    state: 'NY',
    zip: '77777',
    country: 'US',
    add_to_vault: false,
  },
  TEST_CARDS_2D[0],
);

export default function PayPage() {
  const [form, setForm] = useState(DEFAULT);
  const [mode, setMode] = useState('sale');
  /** 2d = direct card sale; 3d = Gateway.js payer auth then sale */
  const [authPath, setAuthPath] = useState('2d');
  const [presetId, setPresetId] = useState(TEST_CARDS_2D[0].id);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [threeDSMeta, setThreeDSMeta] = useState(null);
  const [paymentId, setPaymentId] = useState('');
  const [gatewayOk, setGatewayOk] = useState(false);
  const [publicOk, setPublicOk] = useState(false);
  const [activeInfo, setActiveInfo] = useState(null);
  const [challengeUrl, setChallengeUrl] = useState('');
  const threeDSMountRef = useRef(null);
  const abortRef = useRef(null);

  const presets = authPath === '3d' ? TEST_CARDS_3D : TEST_CARDS_2D;
  const activePreset = useMemo(
    () => presets.find((p) => p.id === presetId) || presets[0],
    [presets, presetId],
  );

  function refreshKeys() {
    const active = getActiveMerchant();
    setActiveInfo(active);
    setPublicOk(Boolean(active?.publicKey) || publicKeyConfigured());
    api.health().then((h) => {
      setGatewayOk(Boolean(h.gateway?.merchant_api_key_set));
      setPublicOk(
        Boolean(active?.publicKey) ||
          Boolean(h.gateway?.public_api_key_set) ||
          publicKeyConfigured(),
      );
    });
  }

  useEffect(() => {
    refreshKeys();
  }, []);

  useEffect(() => {
    // Default to first success card for the selected path (2D Visa / 3D Visa frictionless)
    const next = (authPath === '3d' ? TEST_CARDS_3D : TEST_CARDS_2D)[0];
    setPresetId(next.id);
    setForm((prev) => applyTestCardFields(prev, next));
    setPhase('');
    setError('');
    setThreeDSMeta(null);
    setChallengeUrl('');
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setBusy(false);
    if (threeDSMountRef.current) threeDSMountRef.current.innerHTML = '';
  }, [authPath]);

  function setField(key) {
    return (e) => {
      const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      setForm((prev) => ({ ...prev, [key]: value }));
    };
  }

  function applyPreset(id) {
    const preset = presets.find((p) => p.id === id) || presets[0];
    setPresetId(preset.id);
    setForm((prev) => applyTestCardFields(prev, preset));
  }

  function cancelPay() {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;
    setBusy(false);
    setPhase('');
    setChallengeUrl('');
    setError('Payment cancelled.');
    if (threeDSMountRef.current) threeDSMountRef.current.innerHTML = '';
  }

  async function runPay(e) {
    e.preventDefault();
    if (busy) return;
    refreshKeys();
    if (authPath === '3d' && !(activeInfo?.publicKey || publicKeyConfigured())) {
      setError(
        'This merchant has no tokenization/public key. On Merchants click Generate keys (or Regen keys), then retry 3DS.',
      );
      return;
    }

    setBusy(true);
    setError('');
    setResult(null);
    setThreeDSMeta(null);
    setChallengeUrl('');
    setPhase('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let body = { ...form, amount: Number(form.amount) };

      if (authPath === '3d') {
        if (!threeDSMountRef.current) throw new Error('3DS mount point missing');
        setPhase('Starting Gateway.js 3DS…');
        // Let React paint the mount box before Gateway.js attaches the iframe
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const auth = await authenticate3DS({
          mount: threeDSMountRef.current,
          form: body,
          signal: controller.signal,
          onPhase: (p, detail) => {
            if (p === 'challenge') {
              const url = detail?.challengeUrl || '';
              if (url) setChallengeUrl(url);
              setPhase(
                activePreset?.family === 'cardinal'
                  ? 'Challenge — enter password 1234 (also opened in new tab)'
                  : 'Challenge — enter code 12345 (also opened in new tab)',
              );
            } else if (p === 'complete') setPhase('3DS complete — charging…');
            else if (p === 'started') setPhase('3DS running (fingerprint / challenge)…');
            else if (p === 'error') setPhase('3DS error');
            else setPhase(String(p));
          },
        });
        if (controller.signal.aborted) return;
        if (auth.cardholder_info) {
          setPhase(`Issuer message: ${auth.cardholder_info}`);
        }
        setThreeDSMeta({
          cardholder_auth: auth.cardholder_auth,
          eci: auth.eci,
          cardholder_info: auth.cardholder_info,
        });
        body = { ...body, cardholder_auth: auth.cardholder_auth };
      }

      const data = mode === 'auth' ? await api.payAuth(body) : await api.paySale(body);
      setResult(data);
      setPhase(authPath === '3d' ? 'Sale submitted with 3DS fields' : 'Sale submitted (2D)');
      const id = data.id || data.payment_id || data.transaction_id || '';
      if (id) setPaymentId(String(id));
    } catch (err) {
      if (err?.message !== '3DS cancelled') setError(err.message || String(err));
      setPhase('');
    } finally {
      abortRef.current = null;
      setBusy(false);
      // Frictionless leaves an empty white iframe shell — clear so the UI doesn't look stuck
      if (threeDSMountRef.current) threeDSMountRef.current.innerHTML = '';
    }
  }

  async function runAction(action) {
    if (!paymentId) {
      setError('Enter a payment / transaction id first');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let data;
      if (action === 'capture') data = await api.payCapture(paymentId, { amount: Number(form.amount) });
      else if (action === 'void') data = await api.payVoid(paymentId);
      else if (action === 'refund') data = await api.payRefund(paymentId, { amount: Number(form.amount) });
      else data = await api.getPayment(paymentId);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const canPay = gatewayOk && (authPath === '2d' || publicOk);

  return (
    <div className="panel full">
      <h2>Card payment (REST v5)</h2>
      <p className="muted">
        Charges the <strong>active merchant</strong> from Merchants (session keys), or{' '}
        <code>NMI_MERCHANT_API_KEY</code> from .env.
        {authPath === '3d' ? (
          <>
            {' '}
            3DS uses that merchant’s public key / <code>NMI_PUBLIC_API_KEY</code>.
          </>
        ) : null}{' '}
        <a href="https://docs.nmi.com/docs/testing-sandbox" target="_blank" rel="noreferrer">
          sandbox 3DS test cards
        </a>
        .
      </p>
      <ActiveMerchantBanner />

      {!gatewayOk && (
        <div className="banner warn">
          Generate keys on Merchants, or set <code>NMI_MERCHANT_API_KEY</code> in <code>.env</code>.
        </div>
      )}
      {authPath === '3d' && !publicOk && (
        <div className="banner warn">
          3DS needs a <strong>collectCheckout / public</strong> key for this merchant. Go to Merchants
          → <strong>Regen keys</strong>, then reopen Payment. Debug in Console: <code>[nmi:3ds]</code>.
        </div>
      )}
      {authPath === '3d' && activeInfo?.privateKey && !activeInfo?.publicKey && (
        <div className="banner warn">
          Active merchant <code>{activeInfo.merchantId}</code> has API key{' '}
          <code>{maskKey(activeInfo.privateKey)}</code> but no public key — 3DS will fail. Regen keys
          on Merchants.
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      {phase && <div className="banner warn">{phase}</div>}

      <form className="pay-grid" onSubmit={runPay}>
        <label className="dyn-field">
          Authentication
          <select
            value={authPath}
            onChange={(e) => setAuthPath(e.target.value)}
            aria-label="2D or 3D Secure"
          >
            <option value="2d">2D — card only (no 3DS)</option>
            <option value="3d">3D Secure — Gateway.js then sale</option>
          </select>
        </label>
        <label className="dyn-field">
          Test card preset
          <select value={presetId} onChange={(e) => applyPreset(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {activePreset?.note ? <span className="field-hint">{activePreset.note}</span> : null}
        </label>
        <label className="dyn-field">
          Mode
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="sale">Sale (auth+capture)</option>
            <option value="auth">Auth only</option>
          </select>
        </label>
        <label className="dyn-field">
          Amount
          <input type="number" step="0.01" value={form.amount} onChange={setField('amount')} />
        </label>
        <label className="dyn-field">
          Card number
          <input value={form.card_number} onChange={setField('card_number')} />
        </label>
        <label className="dyn-field">
          Exp (MMYY)
          <input value={form.card_exp} onChange={setField('card_exp')} />
        </label>
        <label className="dyn-field">
          CVV
          <input value={form.card_cvv} onChange={setField('card_cvv')} />
        </label>
        <label className="dyn-field">
          Email (optional — your sandbox account email only)
          <input
            value={form.email}
            onChange={setField('email')}
            placeholder="leave blank to skip"
          />
        </label>
        <label className="dyn-field check">
          <input type="checkbox" checked={form.add_to_vault} onChange={setField('add_to_vault')} />
          Add card to customer vault
        </label>
        <div className="actions">
          <button className="btn" type="submit" disabled={busy || !canPay}>
            {busy
              ? authPath === '3d'
                ? '3DS / charging…'
                : 'Processing…'
              : mode === 'auth'
                ? authPath === '3d'
                  ? '3DS + Authorize'
                  : 'Authorize'
                : authPath === '3d'
                  ? '3DS + Charge'
                  : 'Charge card (2D)'}
          </button>
          {busy ? (
            <button type="button" className="btn secondary" onClick={cancelPay}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      {/* Gateway.js mounts challenge iframe here — only show while 3DS is running */}
      <div
        className={`threeds-mount ${authPath === '3d' && busy ? 'is-visible' : ''}`}
        ref={threeDSMountRef}
        id="nmi-threeds-mount"
        aria-live="polite"
      />
      {authPath === '3d' && busy ? (
        <p className="muted">
          Prefer sandbox PAN <code>4100000000000100</code> (exp <code>1029</code>). Challenge code{' '}
          <strong>12345</strong> (or Cardinal password <strong>1234</strong>). Debug: DevTools →
          Console filter <code>[nmi:3ds]</code>.
          {challengeUrl ? (
            <>
              {' '}
              <a href={challengeUrl} target="_blank" rel="noreferrer">
                Open challenge in new tab
              </a>
              {' '}
              (complete it here or in the tab — stay on this page until charge finishes).
            </>
          ) : null}
        </p>
      ) : null}

      {threeDSMeta && (
        <>
          <h3>3DS result (sent on sale)</h3>
          <pre className="code">{JSON.stringify(threeDSMeta, null, 2)}</pre>
        </>
      )}

      <h3>Follow-up</h3>
      <div className="pay-follow">
        <label className="dyn-field">
          Payment / transaction id
          <input value={paymentId} onChange={(e) => setPaymentId(e.target.value)} />
        </label>
        <div className="actions">
          <button type="button" className="btn secondary" disabled={busy} onClick={() => runAction('get')}>
            Get
          </button>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => runAction('capture')}>
            Capture
          </button>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => runAction('void')}>
            Void
          </button>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => runAction('refund')}>
            Refund
          </button>
        </div>
      </div>

      {result && <pre className="code">{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}
