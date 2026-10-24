function statusTone(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'approved' || s === 'boarded' || s === 'merchant_boarded') return 'ok';
  if (s === 'declined' || s === 'cancelled' || s === 'canceled') return 'bad';
  if (s === 'submitted' || s === 'underwriter_requested_information') return 'warn';
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

export default function ApplicationsList({
  applications = [],
  total,
  selectedId,
  busy,
  onRefresh,
  onSelect,
}) {
  return (
    <section className="apps-panel">
      <div className="apps-panel__head">
        <div>
          <h2>Your applications</h2>
          <p className="muted">
            <code>GET /applications</code>
            {total != null ? ` · ${total} total` : ''}
          </p>
        </div>
        <button type="button" className="btn secondary" disabled={busy} onClick={onRefresh}>
          {busy ? 'Loading…' : 'Refresh list'}
        </button>
      </div>

      {!applications.length ? (
        <p className="muted">No applications yet — create one from a package.</p>
      ) : (
        <div className="apps-table-wrap">
          <table className="apps-table">
            <thead>
              <tr>
                <th>Application</th>
                <th>Status</th>
                <th>Package</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => {
                const id = app.id;
                const tone = statusTone(app.status);
                const selected = selectedId && selectedId === id;
                return (
                  <tr
                    key={id}
                    className={selected ? 'is-selected' : undefined}
                    onClick={() => onSelect?.(app)}
                  >
                    <td>
                      <code>{id}</code>
                    </td>
                    <td>
                      <span className={`status-pill status-pill--${tone}`}>
                        {app.status || '—'}
                      </span>
                    </td>
                    <td>
                      <code>{app.package_id || '—'}</code>
                    </td>
                    <td>{formatWhen(app.updated_at || app.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
