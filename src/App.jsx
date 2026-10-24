import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ApplicationsList from './components/ApplicationsList.jsx';
import ConsentEmbed from './components/ConsentEmbed.jsx';
import PackageForm from './components/PackageForm.jsx';
import * as api from './lib/api.js';
import {
  activateMerchant,
  hasMerchantKeys,
} from './lib/merchantSession.js';
import {
  navigateToView,
  parseLocation,
  VIEWS,
} from './lib/routes.js';
import CustomersPage from './pages/CustomersPage.jsx';
import DocsMapPage from './pages/DocsMapPage.jsx';
import MerchantsPage from './pages/MerchantsPage.jsx';
import PayPage from './pages/PayPage.jsx';
import TransactionsPage from './pages/TransactionsPage.jsx';

const STEPS = ['Packages', 'Application', 'Consent', 'Submit', 'Status'];

const VOLUME_PRESETS = [
  { label: 'Approve ($6,000)', value: 6000 },
  { label: 'Decline ($1,000)', value: 1000 },
  { label: 'Pending info ($100,000)', value: 100000 },
];

function readRoute() {
  return parseLocation(window.location.pathname);
}

export default function App() {
  const [route, setRoute] = useState(() => readRoute());
  const [step, setStep] = useState(0);

  const setView = useCallback((next, { replace = false } = {}) => {
    // Docs “Open sample” for pay/customers/transactions → Merchants (tools are per-merchant).
    const id =
      next === 'pay' || next === 'transactions' || next === 'customers'
        ? 'merchants'
        : VIEWS.some((v) => v.id === next)
          ? next
          : 'docs';
    navigateToView(id, { replace });
    setRoute(readRoute());
  }, []);

  useEffect(() => {
    const sync = () => {
      const next = readRoute();
      if (next.redirect && window.location.pathname !== next.redirect) {
        window.history.replaceState({}, '', next.redirect);
        setRoute(readRoute());
        return;
      }
      if (window.location.pathname === '/' || window.location.pathname === '') {
        navigateToView('docs', { replace: true });
        setRoute(readRoute());
        return;
      }
      if (next.view === 'merchant-tool' && next.merchantId) {
        if (hasMerchantKeys(next.merchantId)) {
          try {
            activateMerchant(next.merchantId);
          } catch {
            /* banner on tool page handles missing keys */
          }
        }
      }
      setRoute(next);
    };
    sync();
    window.addEventListener('popstate', sync);
    window.addEventListener('nmi:navigate', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('nmi:navigate', sync);
    };
  }, []);
  const [health, setHealth] = useState(null);
  const [packages, setPackages] = useState([]);
  const [packageId, setPackageId] = useState('');
  const [packageDetail, setPackageDetail] = useState(null);
  const [packageRules, setPackageRules] = useState([]);
  const [fieldValues, setFieldValues] = useState({});
  const [collectionValues, setCollectionValues] = useState({});
  const [monthlyVolume, setMonthlyVolume] = useState(6000);
  const [application, setApplication] = useState(null);
  const [consentUrl, setConsentUrl] = useState('');
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [applications, setApplications] = useState([]);
  const [applicationsTotal, setApplicationsTotal] = useState(null);
  const [webhooks, setWebhooks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const [pollNote, setPollNote] = useState('');
  const [error, setError] = useState('');
  const [log, setLog] = useState([]);
  const pollAbortRef = useRef(null);

  const pushLog = useCallback((msg) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()} · ${msg}`, ...prev].slice(0, 40));
  }, []);

  const loadApplications = useCallback(async () => {
    setListBusy(true);
    setError('');
    try {
      const data = await api.listApplications();
      const list = data.applications || data.data || (Array.isArray(data) ? data : []);
      setApplications(list);
      setApplicationsTotal(data.total ?? list.length);
      pushLog(`Loaded ${list.length} application(s)`);
      return list;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setListBusy(false);
    }
  }, [pushLog]);

  useEffect(() => {
    api
      .health()
      .then((h) => {
        setHealth(h);
        if (h?.signup?.client_id_set && h?.signup?.client_secret_set) {
          loadApplications();
        }
      })
      .catch((err) => setError(err.message));
    return () => {
      pollAbortRef.current?.abort();
    };
  }, [loadApplications]);

  const credsOk = Boolean(health?.signup?.client_id_set && health?.signup?.client_secret_set);

  async function openApplication(app) {
    const id = app?.id;
    if (!id) return;
    setBusy(true);
    setError('');
    try {
      const fresh = await api.getApplication(id);
      setApplication(fresh);
      setStep(4);
      pushLog(`Opened ${id} · ${fresh.status || app.status || '—'}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function pollUntilDecision(appId) {
    const id = appId || application?.id || application?.application_id;
    if (!id) return null;

    pollAbortRef.current?.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;

    setPolling(true);
    setPollNote('Polling for underwriting decision…');
    pushLog(`Polling ${id} until approved / declined / …`);

    try {
      const result = await api.pollApplicationUntil(id, {
        intervalMs: 2500,
        maxAttempts: 24,
        signal: controller.signal,
        onPoll: ({ application: fresh, polls }) => {
          setApplication(fresh);
          setPollNote(`Poll #${polls} · status: ${fresh.status || '—'}`);
          pushLog(`Poll #${polls} → ${fresh.status || 'unknown'}`);
        },
      });
      setApplication(result.application);
      if (result.timedOut) {
        setPollNote(
          `Still "${result.application.status}" after ${result.polls} polls — try Refresh again later.`,
        );
        pushLog('Poll timed out — status may update via webhook shortly');
      } else {
        setPollNote(`Done · status: ${result.application.status}`);
        pushLog(`Decision: ${result.application.status}`);
      }
      return result.application;
    } finally {
      setPolling(false);
    }
  }

  async function loadPackages() {
    setBusy(true);
    setError('');
    try {
      const data = await api.listPackages();
      const list = data.packages || data.data || (Array.isArray(data) ? data : []);
      setPackages(list);
      if (list[0]?.id && !packageId) setPackageId(list[0].id);
      pushLog(`Loaded ${list.length} package(s)`);
      setStep(0);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function selectPackage(id) {
    setPackageId(id);
    setBusy(true);
    setError('');
    try {
      const form = await api.getPackageForm(id, monthlyVolume);
      setPackageDetail(form.package || form);
      setPackageRules(form.package_rules || form.package?.package_rules || []);
      setFieldValues(form.field_values || {});
      setCollectionValues(form.collection_values || {});
      if (form.field_values?.fld_monthly_volume != null) {
        setMonthlyVolume(Number(form.field_values.fld_monthly_volume));
      }
      pushLog(`Dynamic form loaded from package ${id}`);
      setStep(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function refillDemoValues() {
    if (!packageId) return;
    setBusy(true);
    setError('');
    try {
      const form = await api.getPackageForm(packageId, monthlyVolume);
      setFieldValues(form.field_values || {});
      setCollectionValues(form.collection_values || {});
      pushLog('Re-filled demo values from package schema');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createApp() {
    if (!packageId) {
      setError('Select a package first');
      return;
    }
    setBusy(true);
    setError('');
    setConsentAccepted(false);
    setConsentUrl('');
    try {
      const volume = fieldValues.fld_monthly_volume ?? monthlyVolume;
      const data = await api.createApplication({
        package_id: packageId,
        monthly_volume: volume,
        field_values: { ...fieldValues, fld_monthly_volume: volume },
        collection_values: collectionValues,
      });
      setApplication(data);
      pushLog(`Created application ${data.id || data.application_id || '(see JSON)'}`);
      loadApplications();
      setStep(2);
      await loadConsent(data.id || data.application_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadConsent(appId) {
    const id = appId || application?.id || application?.application_id;
    if (!id) return;
    setBusy(true);
    setError('');
    try {
      let data;
      try {
        data = await api.getLegalConsent(id);
      } catch (err) {
        // Draft missing owner fields — patch sample owners then retry once
        if (/fld_owner_|must be filled|VALIDATION/i.test(err.message || '')) {
          pushLog('Filling missing owner fields, then retrying consent…');
          const updated = await api.fillSampleApplication(id, { monthly_volume: monthlyVolume });
          setApplication(updated);
          data = await api.getLegalConsent(id);
        } else {
          throw err;
        }
      }
      const url = data.url || data.legal_consent_url || data.consent_url || '';
      if (!url) throw new Error('No legal consent URL in response');
      setConsentUrl(url);
      pushLog('Legal consent URL ready');
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function doSubmit() {
    const id = application?.id || application?.application_id;
    if (!id) return;
    if (!consentAccepted) {
      setError('Accept legal consent before submitting');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let data;
      try {
        data = await api.submitApplication(id, { skip_merchant_email: true });
      } catch (err) {
        if (/collection|required|VALIDATION|must be filled/i.test(err.message || '')) {
          pushLog('Missing required collections/fields — filling sample, then retrying submit…');
          const updated = await api.fillSampleApplication(id, { monthly_volume: monthlyVolume });
          setApplication(updated);
          data = await api.submitApplication(id, { skip_merchant_email: true });
        } else {
          throw err;
        }
      }
      setApplication(data);
      pushLog(`Submitted ${id} → status ${data.status || 'submitted'}`);
      setStep(4);
      setBusy(false);
      await pollUntilDecision(id);
      await refreshStatus({ skipBusy: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function refreshStatus({ skipBusy = false } = {}) {
    if (!skipBusy) setBusy(true);
    setError('');
    try {
      const [, hooks] = await Promise.all([loadApplications(), api.webhookLog()]);
      setWebhooks(hooks.events || []);
      const id = application?.id || application?.application_id;
      if (id) {
        const fresh = await api.getApplication(id);
        setApplication(fresh);
      }
      pushLog('Refreshed applications + webhook log');
    } catch (err) {
      setError(err.message);
    } finally {
      if (!skipBusy) setBusy(false);
    }
  }

  const fieldCount = useMemo(() => {
    const fields = packageDetail?.fields || packageDetail?.package?.fields;
    return Array.isArray(fields) ? fields.length : null;
  }, [packageDetail]);

  function onFieldChange(id, value) {
    setFieldValues((prev) => {
      const next = { ...prev, [id]: value };
      if (id === 'fld_monthly_volume') setMonthlyVolume(Number(value) || 0);
      return next;
    });
  }

  function onCollectionFieldChange(colId, recordIndex, fieldId, value) {
    setCollectionValues((prev) => {
      const records = [...(prev[colId] || [])];
      records[recordIndex] = { ...(records[recordIndex] || {}), [fieldId]: value };
      return { ...prev, [colId]: records };
    });
  }

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">NMI · Docs sample</p>
        <h1>Partner + merchant playground</h1>
        <p className="lede">
          <strong>Merchants</strong> boards accounts and opens Pay / Transactions / Customers per
          merchant. Sign-Up is the application workflow.{' '}
          <a href="https://docs.nmi.com/reference/getting-started" target="_blank" rel="noreferrer">
            NMI Getting Started
          </a>
        </p>
      </header>

      <nav className="views" aria-label="Feature areas">
        {VIEWS.map((v) => (
          <a
            key={v.id}
            href={v.path}
            className={`view-tab${
              v.id === 'merchants'
                ? route.view === 'merchants' || route.view === 'merchant-tool'
                  ? ' is-current'
                  : ''
                : route.view === v.id
                  ? ' is-current'
                  : ''
            }`}
            aria-current={
              (v.id === 'merchants' &&
                (route.view === 'merchants' || route.view === 'merchant-tool')) ||
              route.view === v.id
                ? 'page'
                : undefined
            }
            onClick={(e) => {
              e.preventDefault();
              setView(v.id);
            }}
          >
            {v.label}
          </a>
        ))}
      </nav>

      {route.view === 'docs' && <DocsMapPage onOpen={setView} />}
      {route.view === 'merchants' && <MerchantsPage />}
      {route.view === 'merchant-tool' && route.tool === 'pay' && <PayPage />}
      {route.view === 'merchant-tool' && route.tool === 'transactions' && <TransactionsPage />}
      {route.view === 'merchant-tool' && route.tool === 'customers' && <CustomersPage />}

      {route.view === 'signup' && (
        <>
      <nav className="steps" aria-label="Wizard steps">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`step${i === step ? ' is-current' : ''}${i < step ? ' is-done' : ''}`}
            onClick={() => setStep(i)}
          >
            <span>{i + 1}</span>
            {label}
          </button>
        ))}
      </nav>

      {!credsOk && health && (
        <div className="banner warn">
          Add <code>NMI_CLIENT_ID</code> and <code>NMI_CLIENT_SECRET</code> to <code>nmi/.env</code>{' '}
          (copy from <code>.env.example</code>), then restart the API.
        </div>
      )}

      {error && <div className="banner error">{error}</div>}

      {credsOk && (
        <ApplicationsList
          applications={applications}
          total={applicationsTotal}
          selectedId={application?.id || application?.application_id}
          busy={listBusy}
          onRefresh={loadApplications}
          onSelect={openApplication}
        />
      )}

      <main className="panel">
        {step === 0 && (
          <section>
            <h2>1. Choose package template</h2>
            <p className="muted">
              <code>GET /packages</code> lists templates NMI enabled for your partner credentials.
              You cannot invent a package here — if you only see Merrick TSYS, that is what NMI
              assigned. Ask NMI for more packages if you need others.
            </p>
            <div className="actions">
              <button type="button" className="btn" disabled={busy || !credsOk} onClick={loadPackages}>
                {busy ? 'Loading…' : 'Load packages'}
              </button>
            </div>
            <ul className="pkg-list">
              {packages.map((pkg) => (
                <li key={pkg.id}>
                  <button type="button" onClick={() => selectPackage(pkg.id)} disabled={busy}>
                    <strong>{pkg.name || pkg.id}</strong>
                    <span>{pkg.id}</span>
                    {pkg.description && <em>{pkg.description}</em>}
                  </button>
                </li>
              ))}
            </ul>
            {packages.length === 1 && (
              <p className="hint">
                Only one package on this account — use it to create as many new merchants as you want
                (step 2 creates a fresh application each time).
              </p>
            )}
          </section>
        )}

        {step === 1 && (
          <section>
            <h2>2. Create new merchant application</h2>
            <p className="muted">
              Form built from <code>GET /packages/{packageId || '…'}</code>
              {fieldCount != null ? ` · ${fieldCount} fields` : ''}. Edit any value — each create
              boards a new merchant (<code>app_…</code>).
            </p>
            <p className="hint">
              Sandbox decision uses <code>fld_monthly_volume</code>:{' '}
              {VOLUME_PRESETS.map((p) => p.label).join(' · ')}.
            </p>
            <div className="actions">
              <button type="button" className="btn secondary" onClick={() => setStep(0)}>
                Back
              </button>
              <button type="button" className="btn secondary" disabled={busy} onClick={refillDemoValues}>
                Reset demo values
              </button>
              <button type="button" className="btn" disabled={busy || !packageId} onClick={createApp}>
                {busy ? 'Creating…' : 'Create new merchant'}
              </button>
            </div>
            <PackageForm
              packageDetail={packageDetail}
              fieldValues={fieldValues}
              collectionValues={collectionValues}
              packageRules={packageRules}
              onFieldChange={onFieldChange}
              onCollectionFieldChange={onCollectionFieldChange}
            />
            <div className="actions">
              <button type="button" className="btn" disabled={busy || !packageId} onClick={createApp}>
                {busy ? 'Creating…' : 'Create new merchant'}
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <h2>3. Legal consent</h2>
            <p className="muted">
              Application <code>{application?.id || application?.application_id || '—'}</code>
            </p>
            {!consentUrl ? (
              <div className="actions">
                <button type="button" className="btn" disabled={busy} onClick={() => loadConsent()}>
                  Fetch consent URL
                </button>
              </div>
            ) : (
              <>
                <ConsentEmbed
                  consentUrl={consentUrl}
                  onAccepted={setConsentAccepted}
                  onError={(msg) => setError(msg)}
                />
                <p className={`consent-status${consentAccepted ? ' ok' : ''}`}>
                  {consentAccepted ? 'Consent accepted — you can submit.' : 'Waiting for consent…'}
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !consentAccepted}
                    onClick={() => setStep(3)}
                  >
                    Continue to submit
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {step === 3 && (
          <section>
            <h2>4. Submit</h2>
            <p className="muted">
              <code>POST /applications/&#123;id&#125;/submit</code>
            </p>
            <div className="actions">
              <button type="button" className="btn secondary" onClick={() => setStep(2)}>
                Back
              </button>
              <button type="button" className="btn" disabled={busy || !consentAccepted} onClick={doSubmit}>
                {busy ? 'Submitting…' : 'Submit application'}
              </button>
            </div>
            {application && (
              <pre className="code">{JSON.stringify(application, null, 2)}</pre>
            )}
          </section>
        )}

        {step === 4 && (
          <section>
            <h2>5. Status & webhooks</h2>
            <p className="muted">
              After submit, the UI polls <code>GET /applications/:id</code> until sandbox reaches
              approved / declined / pending-info (about every 2.5s).
            </p>
            {pollNote && (
              <p className={`consent-status${polling ? '' : ' ok'}`}>
                {polling ? '⏳ ' : '✓ '}
                {pollNote}
              </p>
            )}
            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={busy || polling || !(application?.id || application?.application_id)}
                onClick={() => pollUntilDecision()}
              >
                {polling ? 'Polling…' : 'Poll until decision'}
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={busy || polling}
                onClick={() => refreshStatus()}
              >
                Refresh once
              </button>
            </div>
            {application && (
              <div className="status-card">
                <h3>Current application</h3>
                <p>
                  <code>{application.id || application.application_id}</code>
                  {application.status && (
                    <>
                      {' '}
                      · <strong>{application.status}</strong>
                    </>
                  )}
                </p>
                {application.gateway_id || application.merchant_id || application.mid ? (
                  <p className="muted">
                    {application.gateway_id && (
                      <>
                        Gateway <code>{application.gateway_id}</code>{' '}
                      </>
                    )}
                    {(application.merchant_id || application.mid) && (
                      <>
                        MID <code>{application.merchant_id || application.mid}</code>
                      </>
                    )}
                  </p>
                ) : null}
              </div>
            )}
            <p className="hint">All applications are listed above — click a row to open details here.</p>
            <h3>Sign-Up webhooks</h3>
            <p className="muted">
              Inbox:{' '}
              {health?.webhook?.public_url ? (
                <a href={health.webhook.public_url} target="_blank" rel="noreferrer">
                  {health.webhook.public_url}
                </a>
              ) : (
                <code>NMI_WEBHOOK_PUBLIC_URL</code>
              )}
              . Register once via{' '}
              <a
                href="https://docs.nmi.com/reference/createsubscription"
                target="_blank"
                rel="noreferrer"
              >
                POST /subscriptions
              </a>
              ; events show on webhook.cool (not in this Vite app).
            </p>
            <div className="actions">
              <button
                type="button"
                className="btn secondary"
                disabled={busy || !health?.webhook?.public_url}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const sub = await api.registerWebhookSubscription();
                    pushLog(
                      `Webhook subscribed → ${sub.callback_url || health.webhook.public_url} (${sub.id || 'ok'})`,
                    );
                  } catch (err) {
                    setError(err.message);
                    pushLog(`Webhook register failed: ${err.message}`);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Register webhook with NMI
              </button>
            </div>
            <h3>Webhook inbox</h3>
            <ul className="simple-list">
              {webhooks
                .slice()
                .reverse()
                .slice(0, 10)
                .map((ev, i) => (
                  <li key={ev.event_id || i}>
                    {ev.at} · {ev.event_type || 'event'} ·{' '}
                    {ev.verified ? 'signed' : ev.verify_reason || 'unverified'}
                  </li>
                ))}
              {!webhooks.length && (
                <li className="muted">
                  {health?.webhook?.public_url ? (
                    <>
                      Open{' '}
                      <a href={health.webhook.public_url} target="_blank" rel="noreferrer">
                        {health.webhook.public_url.replace(/^https?:\/\//, '')}
                      </a>{' '}
                      to see deliveries (<code>NMI_WEBHOOK_PUBLIC_URL</code>).
                    </>
                  ) : (
                    <>
                      Set <code>NMI_WEBHOOK_PUBLIC_URL</code> in <code>nmi/.env</code>, then restart
                      Vite.
                    </>
                  )}
                </li>
              )}
            </ul>
          </section>
        )}
      </main>

      <aside className="sidebar">
        <h2>Activity</h2>
        <ul className="log">
          {log.map((line) => (
            <li key={line}>{line}</li>
          ))}
          {!log.length && <li className="muted">Actions appear here</li>}
        </ul>
        {health && (
          <div className="meta">
            <p>
              Sign-Up <code>{health.signup?.base_url}</code>
            </p>
            <p>OAuth {credsOk ? 'ready' : 'missing'}</p>
            <p>
              Gateway {health.gateway?.merchant_api_key_set ? 'key set' : 'no merchant key'}
            </p>
            {health.webhook?.public_url && (
              <p>
                Webhook{' '}
                <a href={health.webhook.public_url} target="_blank" rel="noreferrer">
                  inbox
                </a>
              </p>
            )}
          </div>
        )}
      </aside>
        </>
      )}
    </div>
  );
}
