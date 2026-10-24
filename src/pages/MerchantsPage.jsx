import { useCallback, useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { CA_PROVINCES, COUNTRIES, US_STATES } from '../lib/countries.js';
import {
  activateMerchant,
  clearMerchantKeys,
  getActiveMerchantId,
  hasMerchantKeys,
  maskKey,
  getMerchantKeys,
} from '../lib/merchantSession.js';
import { navigateToMerchantTool } from '../lib/routes.js';

function statusTone(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'active') return 'ok';
  if (s === 'pending' || s === 'test') return 'warn';
  if (s === 'closed' || s === 'disabled') return 'bad';
  return 'muted';
}

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const USERNAME_RE = /^[A-Za-z0-9]{4,32}$/;

/** Prefill demo values for sandbox Create Merchant (unique username each call). */
const emptyForm = () => {
  const stamp = Date.now().toString(36).slice(-6);
  const email =
    String(import.meta.env.NMI_SANDBOX_EMAIL || '').trim() || 'merchant@example.com';
  return {
    // Sandbox partners can only board type=test.
    type: 'test',
    company: 'One9Tech Test Merchant',
    externalIdentifier: `one9-demo-${stamp}`,
    country: 'US',
    address1: '123 Main Street',
    address2: 'Suite 100',
    city: 'Chicago',
    state: 'IL',
    zip: '60601',
    url: 'https://one9pay.com',
    timezone: 'America/Chicago',
    language: 'en_US',
    firstName: 'Alex',
    lastName: 'Merchant',
    email,
    phone: '555-555-0100',
    fax: '',
    username: `one9m${stamp}`.slice(0, 32),
    checkAccount: '123123123',
    checkAba: '123123123',
    accountHolderType: 'business',
    accountType: 'checking',
  };
};

export default function MerchantsPage() {
  const [health, setHealth] = useState(null);
  const [merchants, setMerchants] = useState([]);
  const [total, setTotal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [keyingId, setKeyingId] = useState(null);
  const [keysTick, setKeysTick] = useState(0);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const partnerOk = Boolean(health?.partner?.partner_api_key_set);
  const activeId = getActiveMerchantId();
  void keysTick;

  const loadMerchants = useCallback(async (q = search) => {
    setListBusy(true);
    setError('');
    try {
      const data = await api.listPartnerMerchants({
        maxResults: 100,
        ...(q.trim() ? { search: q.trim() } : {}),
      });
      const rows = data.results || data.merchants || [];
      setMerchants(rows);
      setTotal(data.totalResults ?? rows.length);
      setNote(`Loaded ${rows.length} merchant(s) under partner`);
      return rows;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setListBusy(false);
    }
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((h) => {
        if (cancelled) return;
        setHealth(h);
        if (h?.partner?.partner_api_key_set) {
          setListBusy(true);
          return api
            .listPartnerMerchants({ maxResults: 100 })
            .then((data) => {
              if (cancelled) return;
              const rows = data.results || data.merchants || [];
              setMerchants(rows);
              setTotal(data.totalResults ?? rows.length);
              setNote(`Loaded ${rows.length} merchant(s) under partner`);
            })
            .catch((err) => {
              if (!cancelled) setError(err.message);
            })
            .finally(() => {
              if (!cancelled) setListBusy(false);
            });
        }
        return undefined;
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function setField(key, value) {
    setForm((prev) => {
      if (key === 'country' && value !== prev.country) {
        return { ...prev, country: value, state: '' };
      }
      return { ...prev, [key]: value };
    });
  }

  async function onCreate(e) {
    e.preventDefault();
    if (!partnerOk) return;
    setBusy(true);
    setError('');
    setNote('');
    try {
      const company = form.company.trim();
      const username = form.username.trim();
      const email = form.email.trim();
      if (!company) throw new Error('Company Name is required.');
      if (!form.country) throw new Error('Country is required.');
      if (!form.address1.trim()) throw new Error('Address is required.');
      if (!form.city.trim()) throw new Error('City is required.');
      if (!form.state) throw new Error('State is required.');
      if (!form.zip.trim()) throw new Error('Zip/Postal Code is required.');
      if (!form.timezone) throw new Error('Timezone is required.');
      if (!form.language) throw new Error('Language is required.');
      if (!form.firstName.trim()) throw new Error('First Name is required.');
      if (!form.lastName.trim()) throw new Error('Last Name is required.');
      if (!email) throw new Error('Email Address is required.');
      if (!form.phone.trim()) throw new Error('Phone Number is required.');
      if (!USERNAME_RE.test(username)) {
        throw new Error('Username must be 4–32 letters and/or numbers only.');
      }
      if (!form.checkAccount.trim() || !form.checkAba.trim()) {
        throw new Error('Billing account number and ABA/routing are required by the NMI API.');
      }

      const payload = {
        type: form.type || 'test',
        company,
        country: form.country,
        address1: form.address1.trim(),
        city: form.city.trim(),
        state: form.state,
        zip: form.zip.trim(),
        timezone: form.timezone,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email,
        phone: form.phone.trim(),
        language: form.language,
        username,
        accountInfo: {
          checkAccount: form.checkAccount.trim(),
          checkAba: form.checkAba.trim(),
          accountHolderType: form.accountHolderType || 'business',
          accountType: form.accountType || 'checking',
        },
      };
      if (form.externalIdentifier.trim()) {
        payload.externalIdentifier = form.externalIdentifier.trim();
      }
      if (form.address2.trim()) payload.address2 = form.address2.trim();
      if (form.url.trim()) payload.url = form.url.trim();
      if (form.fax.trim()) payload.fax = form.fax.trim();

      const created = await api.createPartnerMerchant(payload);
      setSelected(created);
      setNote(`Created merchant ${created.id || created.company || ''} · status ${created.status || '—'}`);
      setForm(emptyForm());
      await loadMerchants('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onGenerateKeys(merchant) {
    const id = merchant?.id;
    if (!id || !partnerOk) return;
    setKeyingId(String(id));
    setError('');
    setNote('');
    try {
      const saved = await api.generateMerchantKeys(merchant);
      setKeysTick((n) => n + 1);
      setSelected(merchant);
      setNote(
        `Keys ready for ${merchant.company || id} · private ${maskKey(saved.privateKey)}` +
          (saved.publicKey ? ` · public ${maskKey(saved.publicKey)}` : ''),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setKeyingId(null);
    }
  }

  function openMerchantTool(merchant, tool) {
    const id = merchant?.id;
    if (!id) return;
    if (!hasMerchantKeys(id)) {
      setError(`Generate keys for ${merchant.company || id} before opening ${tool}.`);
      return;
    }
    try {
      activateMerchant(id);
      setKeysTick((n) => n + 1);
      navigateToMerchantTool(id, tool);
    } catch (err) {
      setError(err.message);
    }
  }

  async function onRemove(merchant) {
    const id = merchant?.id;
    if (!id || !partnerOk) return;
    const label = merchant.company || id;
    const ok = window.confirm(
      `Delete merchant “${label}” (gateway ${id})?\n\nThis cannot be undone.`,
    );
    if (!ok) return;
    setDeletingId(String(id));
    setError('');
    setNote('');
    try {
      await api.deletePartnerMerchant(id);
      clearMerchantKeys(id);
      setKeysTick((n) => n + 1);
      if (selected?.id && String(selected.id) === String(id)) setSelected(null);
      setNote(`Deleted merchant ${id}`);
      await loadMerchants(search);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="panel full">
      <section>
        <h2>Partner merchants</h2>
        <p className="muted">
          Same accounts as{' '}
          <a href="https://sandbox.nmi.com/partners/accounts" target="_blank" rel="noreferrer">
            Partner console → Accounts
          </a>
          . Generate security keys per merchant, then open <strong>Pay</strong> /{' '}
          <strong>Tx</strong> / <strong>Customers</strong> for that account. Keys stay in session
          storage (sandbox sample).
        </p>

        {!partnerOk && health && (
          <div className="banner warn">
            Set <code>NMI_PARTNER_API_KEY</code> in <code>nmi/.env</code> (Partner Keys ·{' '}
            <code>v4_secret_…</code>), then restart Vite.
          </div>
        )}

        {error && <div className="banner error">{error}</div>}
        {note && <p className="consent-status ok">{note}</p>}

        <div className="apps-panel" style={{ marginTop: '1rem' }}>
          <div className="apps-panel__head">
            <div>
              <h3 style={{ margin: 0 }}>Merchants under partner</h3>
              <p className="muted" style={{ margin: '0.25rem 0 0' }}>
                {total != null ? `${total} total` : '—'}
              </p>
            </div>
            <div className="actions" style={{ margin: 0 }}>
              <input
                className="field-input"
                style={{ minWidth: 160 }}
                placeholder="Search company / email"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') loadMerchants(search);
                }}
              />
              <button
                type="button"
                className="btn secondary"
                disabled={listBusy || !partnerOk}
                onClick={() => loadMerchants(search)}
              >
                {listBusy ? 'Loading…' : 'Refresh'}
              </button>
            </div>
          </div>

          {!merchants.length ? (
            <p className="muted">No merchants yet — create one below.</p>
          ) : (
            <div className="apps-table-wrap">
              <table className="apps-table">
                <thead>
                  <tr>
                    <th>Gateway ID</th>
                    <th>Company</th>
                    <th>Status</th>
                    <th>Keys</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {merchants.map((m) => {
                    const id = m.id;
                    const selectedRow = selected?.id && String(selected.id) === String(id);
                    const removing = deletingId === String(id);
                    const keying = keyingId === String(id);
                    const keyed = hasMerchantKeys(id);
                    const keys = keyed ? getMerchantKeys(id) : null;
                    const isActive = activeId === String(id);
                    return (
                      <tr
                        key={id}
                        className={selectedRow || isActive ? 'is-selected' : undefined}
                        onClick={() => setSelected(m)}
                      >
                        <td>
                          <code>{id}</code>
                          {isActive ? (
                            <>
                              <br />
                              <span className="status-pill status-pill--ok">active</span>
                            </>
                          ) : null}
                        </td>
                        <td>
                          <strong>{m.company || '—'}</strong>
                          {m.email ? (
                            <>
                              <br />
                              <span className="muted">{m.email}</span>
                            </>
                          ) : null}
                        </td>
                        <td>
                          <span className={`status-pill status-pill--${statusTone(m.status)}`}>
                            {m.status || '—'}
                          </span>
                        </td>
                        <td>
                          {keyed ? (
                            <span className="muted" title={keys?.privateKey || ''}>
                              {maskKey(keys?.privateKey)}
                              {keys?.publicKey ? (
                                <>
                                  <br />
                                  pub {maskKey(keys.publicKey)}
                                </>
                              ) : null}
                            </span>
                          ) : (
                            <span className="muted">Not generated</span>
                          )}
                        </td>
                        <td>
                          <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                            {!keyed ? (
                              <button
                                type="button"
                                className="btn"
                                disabled={keying || !partnerOk}
                                onClick={() => onGenerateKeys(m)}
                              >
                                {keying ? 'Generating…' : 'Generate keys'}
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => openMerchantTool(m, 'pay')}
                                >
                                  Payment
                                </button>
                                <button
                                  type="button"
                                  className="btn secondary"
                                  onClick={() => openMerchantTool(m, 'transactions')}
                                >
                                  Transactions
                                </button>
                                <button
                                  type="button"
                                  className="btn secondary"
                                  onClick={() => openMerchantTool(m, 'customers')}
                                >
                                  Customers
                                </button>
                                <button
                                  type="button"
                                  className="btn secondary"
                                  disabled={keying || !partnerOk}
                                  onClick={() => onGenerateKeys(m)}
                                  title="Create a new key pair"
                                >
                                  {keying ? '…' : 'Regen keys'}
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              className="btn secondary btn-danger-quiet"
                              disabled={removing || busy || !partnerOk}
                              onClick={() => onRemove(m)}
                            >
                              {removing ? 'Removing…' : 'Remove'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selected && (
          <div className="status-card" style={{ marginTop: '1rem' }}>
            <div className="apps-panel__head" style={{ marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0 }}>Selected merchant</h3>
              <div className="row-actions">
                {!hasMerchantKeys(selected.id) ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={keyingId === String(selected.id) || !partnerOk}
                    onClick={() => onGenerateKeys(selected)}
                  >
                    {keyingId === String(selected.id) ? 'Generating…' : 'Generate keys first'}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => openMerchantTool(selected, 'pay')}
                    >
                      Payment
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => openMerchantTool(selected, 'transactions')}
                    >
                      Transactions
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => openMerchantTool(selected, 'customers')}
                    >
                      Customers
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="btn secondary btn-danger-quiet"
                  disabled={deletingId === String(selected.id) || !partnerOk}
                  onClick={() => onRemove(selected)}
                >
                  {deletingId === String(selected.id) ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
            {hasMerchantKeys(selected.id) ? (
              <p className="muted">
                Session keys: private <code>{maskKey(getMerchantKeys(selected.id)?.privateKey)}</code>
                {getMerchantKeys(selected.id)?.publicKey ? (
                  <>
                    {' '}
                    · public <code>{maskKey(getMerchantKeys(selected.id)?.publicKey)}</code>
                  </>
                ) : null}
              </p>
            ) : (
              <p className="muted">Generate keys to use Pay / Transactions / Customers for this merchant.</p>
            )}
            <pre className="code">{JSON.stringify(selected, null, 2)}</pre>
          </div>
        )}

        <form className="stack" style={{ marginTop: '1.5rem' }} onSubmit={onCreate}>
          <h3>Create merchant under partner</h3>
          <p className="muted">
            Same fields as Partner Portal → Merchant Information. Required fields match NMI boarding.
            Sandbox uses <code>type: test</code>.
          </p>

          <h4 className="form-section-title">Merchant Information</h4>
          <div className="form-grid">
            <label className="field">
              <span>
                Account type <em className="req">*</em>
              </span>
              <select
                className="field-input"
                required
                value={form.type}
                onChange={(e) => setField('type', e.target.value)}
              >
                <option value="test">test (sandbox)</option>
                <option value="gateway">gateway (live partners)</option>
              </select>
            </label>
            <label className="field">
              <span>
                Company Name <em className="req">*</em>
              </span>
              <input
                className="field-input"
                required
                value={form.company}
                onChange={(e) => setField('company', e.target.value)}
              />
            </label>
            <label className="field">
              <span>External Identifier</span>
              <input
                className="field-input"
                value={form.externalIdentifier}
                onChange={(e) => setField('externalIdentifier', e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                Country <em className="req">*</em>
              </span>
              <select
                className="field-input"
                required
                value={form.country}
                onChange={(e) => setField('country', e.target.value)}
              >
                <option value="">- Select Country -</option>
                {COUNTRIES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>
                Address <em className="req">*</em>
              </span>
              <input
                className="field-input"
                required
                value={form.address1}
                onChange={(e) => setField('address1', e.target.value)}
              />
            </label>
            <label className="field">
              <span>Address 2</span>
              <input
                className="field-input"
                value={form.address2}
                onChange={(e) => setField('address2', e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                City <em className="req">*</em>
              </span>
              <input
                className="field-input"
                required
                value={form.city}
                onChange={(e) => setField('city', e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                State / Province / Region <em className="req">*</em>
              </span>
              {form.country === 'US' ? (
                <select
                  className="field-input"
                  required
                  value={form.state}
                  onChange={(e) => setField('state', e.target.value)}
                >
                  <option value="">- Select State -</option>
                  {US_STATES.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : form.country === 'CA' ? (
                <select
                  className="field-input"
                  required
                  value={form.state}
                  onChange={(e) => setField('state', e.target.value)}
                >
                  <option value="">- Select Province -</option>
                  {CA_PROVINCES.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="field-input"
                  required
                  value={form.state}
                  onChange={(e) => setField('state', e.target.value)}
                  placeholder="State / province / region"
                />
              )}
            </label>
            <label className="field">
              <span>
                Zip/Postal Code <em className="req">*</em>
              </span>
              <input
                className="field-input"
                required
                value={form.zip}
                onChange={(e) => setField('zip', e.target.value)}
              />
            </label>
            <label className="field">
              <span>Website</span>
              <input
                className="field-input"
                type="url"
                placeholder="https://"
                value={form.url}
                onChange={(e) => setField('url', e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                Timezone <em className="req">*</em>
              </span>
              <select
                className="field-input"
                required
                value={form.timezone}
                onChange={(e) => setField('timezone', e.target.value)}
              >
                <option value="America/Chicago">(GMT-06:00) Central Time (US &amp; Canada)</option>
                <option value="America/New_York">(GMT-05:00) Eastern Time (US &amp; Canada)</option>
                <option value="America/Denver">(GMT-07:00) Mountain Time (US &amp; Canada)</option>
                <option value="America/Los_Angeles">(GMT-08:00) Pacific Time (US &amp; Canada)</option>
                <option value="America/Phoenix">(GMT-07:00) Arizona</option>
              </select>
            </label>
            <label className="field">
              <span>
                Language <em className="req">*</em>
              </span>
              <select
                className="field-input"
                required
                value={form.language}
                onChange={(e) => setField('language', e.target.value)}
              >
                <option value="en_US">English</option>
                <option value="es_ES">Spanish</option>
                <option value="fr_CA">French (Canada)</option>
              </select>
            </label>
          </div>

          <h4 className="form-section-title">Company Contact</h4>
          <p className="muted">
            Primary user on the merchant account — receives the welcome email. Shown on receipts if
            enabled.
          </p>
          <div className="form-grid">
            <label className="field">
              <span>
                First Name <em className="req">*</em>
              </span>
              <input
                className="field-input"
                required
                value={form.firstName}
                onChange={(e) => setField('firstName', e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                Last Name <em className="req">*</em>
              </span>
              <input
                className="field-input"
                required
                value={form.lastName}
                onChange={(e) => setField('lastName', e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                Email Address <em className="req">*</em>
              </span>
              <input
                className="field-input"
                type="email"
                required
                value={form.email}
                onChange={(e) => setField('email', e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                Phone Number <em className="req">*</em>
              </span>
              <input
                className="field-input"
                required
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
              />
            </label>
            <label className="field">
              <span>Fax Number</span>
              <input
                className="field-input"
                value={form.fax}
                onChange={(e) => setField('fax', e.target.value)}
              />
            </label>
          </div>

          <h4 className="form-section-title">Primary Username</h4>
          <p className="muted">4–32 characters, letters and/or numbers only.</p>
          <div className="form-grid">
            <label className="field">
              <span>
                Username <em className="req">*</em>
              </span>
              <input
                className="field-input"
                required
                minLength={4}
                maxLength={32}
                pattern="[A-Za-z0-9]{4,32}"
                title="4–32 letters and/or numbers"
                value={form.username}
                onChange={(e) => setField('username', e.target.value)}
              />
            </label>
          </div>

          <h4 className="form-section-title">Billing account (API required)</h4>
          <p className="muted">
            Partner Portal may collect this later; Create Merchant API requires{' '}
            <code>accountInfo</code>.
          </p>
          <div className="form-grid">
            <label className="field">
              <span>
                Account number <em className="req">*</em>
              </span>
              <input
                className="field-input"
                required
                value={form.checkAccount}
                onChange={(e) => setField('checkAccount', e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                ABA / routing <em className="req">*</em>
              </span>
              <input
                className="field-input"
                required
                value={form.checkAba}
                onChange={(e) => setField('checkAba', e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                Account holder type <em className="req">*</em>
              </span>
              <select
                className="field-input"
                required
                value={form.accountHolderType}
                onChange={(e) => setField('accountHolderType', e.target.value)}
              >
                <option value="business">business</option>
                <option value="personal">personal</option>
              </select>
            </label>
            <label className="field">
              <span>
                Account type <em className="req">*</em>
              </span>
              <select
                className="field-input"
                required
                value={form.accountType}
                onChange={(e) => setField('accountType', e.target.value)}
              >
                <option value="checking">checking</option>
                <option value="savings">savings</option>
              </select>
            </label>
          </div>

          <div className="actions">
            <button type="submit" className="btn" disabled={busy || !partnerOk}>
              {busy ? 'Creating…' : 'Create merchant'}
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => setForm(emptyForm())}
            >
              Reset / refill demo
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
