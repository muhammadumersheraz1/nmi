import { useEffect, useState } from 'react';
import ActiveMerchantBanner from '../components/ActiveMerchantBanner.jsx';
import * as api from '../lib/api.js';

const DEFAULT = {
  first_name: 'Jane',
  last_name: 'Shopper',
  email: '',
  card_number: '4111111111111111',
  card_exp: '1029',
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [apps, setApps] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [gatewayOk, setGatewayOk] = useState(false);
  const [form, setForm] = useState(DEFAULT);
  const [created, setCreated] = useState(null);

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

  function setField(key) {
    return (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));
  }

  async function load() {
    setBusy(true);
    setError('');
    try {
      const data = await api.listCustomers();
      const list = data.customers || data.data || (Array.isArray(data) ? data : []);
      setCustomers(list);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const billing = {
        first_name: form.first_name,
        last_name: form.last_name,
        payment_details: {
          card_number: form.card_number,
          card_exp: form.card_exp,
        },
      };
      if (form.email.trim()) billing.email = form.email.trim();
      const data = await api.createCustomer({ billing });
      setCreated(data);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const approved = apps.filter((a) =>
    /approved|boarded/i.test(String(a.status || '')),
  );

  return (
    <div className="panel full">
      <h2>Customers (Vault)</h2>
      <p className="muted">
        Vault customers for the <strong>active merchant</strong> (keys from Merchants, or{' '}
        <code>NMI_MERCHANT_API_KEY</code>).
      </p>
      <ActiveMerchantBanner />
      {approved.length > 0 && (
        <p className="muted">
          Approved applications from NMI:{' '}
          {approved.map((a) => a.id).join(', ')}
        </p>
      )}
      {!gatewayOk && (
        <div className="banner warn">
          Generate keys on Merchants, or set <code>NMI_MERCHANT_API_KEY</code> in <code>.env</code>.
        </div>
      )}
      {error && <div className="banner error">{error}</div>}

      <form className="pay-grid" onSubmit={create}>
        <label className="dyn-field">
          First name
          <input value={form.first_name} onChange={setField('first_name')} />
        </label>
        <label className="dyn-field">
          Last name
          <input value={form.last_name} onChange={setField('last_name')} />
        </label>
        <label className="dyn-field">
          Email (optional)
          <input value={form.email} onChange={setField('email')} placeholder="leave blank" />
        </label>
        <label className="dyn-field">
          Card number
          <input value={form.card_number} onChange={setField('card_number')} required />
        </label>
        <label className="dyn-field">
          Exp (MMYY)
          <input value={form.card_exp} onChange={setField('card_exp')} required />
        </label>
        <div className="actions">
          <button className="btn" type="submit" disabled={busy || !gatewayOk}>
            Create customer + vault card
          </button>
          <button type="button" className="btn secondary" disabled={busy || !gatewayOk} onClick={load}>
            Refresh list
          </button>
        </div>
      </form>

      {created && <pre className="code">{JSON.stringify(created, null, 2)}</pre>}

      <div className="apps-table-wrap">
        <table className="apps-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name / email</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => {
              const id = c.id || c.customer_vault_id || c.customer_id;
              const billing = Array.isArray(c.billing) ? c.billing[0] : c.billing;
              return (
                <tr key={id || JSON.stringify(c)}>
                  <td>
                    <code>{id || '—'}</code>
                  </td>
                  <td>
                    {[billing?.first_name, billing?.last_name].filter(Boolean).join(' ') || '—'}
                    {billing?.email ? ` · ${billing.email}` : ''}
                  </td>
                </tr>
              );
            })}
            {!customers.length && (
              <tr>
                <td colSpan={2} className="muted">
                  No customers loaded
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
