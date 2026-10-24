import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';

export default function DocsMapPage({ onOpen }) {
  const [catalog, setCatalog] = useState([]);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.docsCatalog(), api.health()])
      .then(([docs, h]) => {
        setCatalog(docs.catalog || []);
        setHealth(h);
      })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="panel full">
      <h2>NMI docs → this sample</h2>
      <p className="muted">
        Full platform docs:{' '}
        <a href="https://docs.nmi.com/reference/getting-started" target="_blank" rel="noreferrer">
          Getting Started
        </a>
        . This app demos the main partner + merchant flows; items marked <em>docs</em> are linked only.
      </p>
      {error && <div className="banner error">{error}</div>}
      {health && (
        <div className="keys-grid">
          <div className={`key-card${health.signup?.client_id_set ? ' ok' : ''}`}>
            <strong>Sign-Up OAuth</strong>
            <span>{health.signup?.client_id_set ? 'Client ID/secret set' : 'Missing NMI_CLIENT_*'}</span>
            <code>{health.signup?.base_url}</code>
          </div>
          <div className={`key-card${health.gateway?.merchant_api_key_set ? ' ok' : ''}`}>
            <strong>Merchant API key</strong>
            <span>
              {health.gateway?.merchant_api_key_set
                ? 'Ready for pay / customers / transactions'
                : 'Set NMI_MERCHANT_API_KEY'}
            </span>
            <code>{health.gateway?.gateway_base_url}</code>
          </div>
          <div className={`key-card${health.signup?.mode === 'direct' ? ' ok' : ''}`}>
            <strong>API mode</strong>
            <span>
              Sign-Up → direct NMI (Network tab). Gateway → Vite <code>/nmi-gateway</code> proxy.
            </span>
            <code>{health.signup?.base_url || 'https://sandbox.signup.nmi.com/api/v1'}</code>
          </div>
          <div className={`key-card${health.webhook?.public_url ? ' ok' : ''}`}>
            <strong>Sign-Up webhook</strong>
            <span>
              {health.webhook?.public_url
                ? 'Open inbox to see application events'
                : 'Set NMI_WEBHOOK_PUBLIC_URL'}
            </span>
            {health.webhook?.public_url ? (
              <a href={health.webhook.public_url} target="_blank" rel="noreferrer">
                {health.webhook.public_url}
              </a>
            ) : (
              <code>webhook.cool</code>
            )}
          </div>
        </div>
      )}
      <div className="catalog">
        {catalog.map((area) => (
          <article key={area.area} className="catalog-card">
            <header>
              <h3>{area.area}</h3>
              {area.sample && (
                <button type="button" className="btn secondary" onClick={() => onOpen?.(area.sample)}>
                  Open sample
                </button>
              )}
            </header>
            <p className="muted">
              <a href={area.docs} target="_blank" rel="noreferrer">
                Docs
              </a>
            </p>
            <ul>
              {(area.items || []).map((item) => (
                <li key={item.name}>
                  <span className={`tag tag--${item.status}`}>{item.status}</span>{' '}
                  <a href={item.href} target="_blank" rel="noreferrer">
                    {item.name}
                  </a>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}
