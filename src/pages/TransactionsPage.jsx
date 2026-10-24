import { useEffect, useState } from 'react';
import ActiveMerchantBanner from '../components/ActiveMerchantBanner.jsx';
import * as api from '../lib/api.js';

/** Tone for NMI Query `condition` (original status string). */
function conditionTone(condition) {
  const s = String(condition || '').toLowerCase();
  if (s === 'complete' || s === 'pendingsettlement') return 'ok';
  if (s === 'failed' || s === 'canceled' || s === 'cancelled' || s === 'abandoned') return 'bad';
  if (s === 'pending' || s === 'in_progress' || s === 'unknown') return 'warn';
  return 'muted';
}

/** Tone for NMI action `success` (1 / 0). */
function successTone(success) {
  const s = String(success ?? '').trim();
  if (s === '1') return 'ok';
  if (s === '0') return 'bad';
  return 'muted';
}

export default function TransactionsPage() {
  const [rows, setRows] = useState([]);
  const [apps, setApps] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [gatewayOk, setGatewayOk] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [raw, setRaw] = useState('');

  useEffect(() => {
    api.health().then((h) => setGatewayOk(Boolean(h.gateway?.merchant_api_key_set)));
    api
      .listApplications()
      .then((data) => {
        const list = data.applications || data.data || (Array.isArray(data) ? data : []);
        setApps(list);
      })
      .catch(() => {});
  }, []);

  async function load() {
    setBusy(true);
    setError('');
    try {
      const data = await api.listTransactions({ result_limit: 50 });
      setRows(data.transactions || []);
      setRaw(data.raw || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const approved = apps.filter((a) => /approved|boarded/i.test(String(a.status || '')));

  return (
    <div className="panel full">
      <h2>Transactions</h2>
      <p className="muted">
        Query API for the <strong>active merchant</strong> (keys from Merchants tab, or{' '}
        <code>NMI_MERCHANT_API_KEY</code>). Status is NMI{' '}
        <code>condition</code> (complete, failed, canceled, pendingsettlement, …); Success is NMI
        action <code>success</code> (1/0).
      </p>
      <ActiveMerchantBanner />
      {approved.length > 0 && (
        <p className="muted">Approved apps: {approved.map((a) => a.id).join(', ')}</p>
      )}
      {!gatewayOk && (
        <div className="banner warn">
          Generate keys on Merchants, or set <code>NMI_MERCHANT_API_KEY</code> in <code>.env</code>.
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      <div className="actions">
        <button type="button" className="btn" disabled={busy || !gatewayOk} onClick={load}>
          {busy ? 'Loading…' : 'Load transactions'}
        </button>
        <button type="button" className="btn secondary" disabled={!raw} onClick={() => setRawOpen((v) => !v)}>
          {rawOpen ? 'Hide raw XML' : 'Show raw XML'}
        </button>
      </div>
      <div className="apps-table-wrap">
        <table className="apps-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Success</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Response</th>
              <th>Card</th>
              <th>Customer</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const actionTypes =
                Array.isArray(t.actions) && t.actions.length
                  ? t.actions.map((a) => a.action_type).filter(Boolean).join(' → ')
                  : t.action_type;
              return (
                <tr key={t.transaction_id || JSON.stringify(t)}>
                  <td>
                    <code>{t.transaction_id || '—'}</code>
                  </td>
                  <td>
                    <span className={`status-pill status-pill--${conditionTone(t.condition)}`}>
                      {t.condition || '—'}
                    </span>
                  </td>
                  <td>
                    <span className={`status-pill status-pill--${successTone(t.success)}`}>
                      {t.success == null || t.success === '' ? '—' : String(t.success)}
                    </span>
                  </td>
                  <td>{actionTypes || '—'}</td>
                  <td>{t.amount || '—'}</td>
                  <td title={t.response_code ? `code ${t.response_code}` : undefined}>
                    {t.response_text || '—'}
                    {t.response_code ? (
                      <span className="muted"> ({t.response_code})</span>
                    ) : null}
                  </td>
                  <td>{t.cc_number || '—'}</td>
                  <td>
                    {[t.first_name, t.last_name].filter(Boolean).join(' ') || t.email || '—'}
                  </td>
                  <td>{t.date || '—'}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="muted">
                  No rows yet — charge a card on Pay, then refresh.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rawOpen && raw && <pre className="code">{raw.slice(0, 8000)}</pre>}
    </div>
  );
}
