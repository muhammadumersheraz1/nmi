/** Dynamic merchant application form built from GET /packages/:id schema. */

function FieldInput({ field, value, onChange }) {
  const t = String(field.type || 'string').toLowerCase();
  const id = field.id;
  const label = (
    <span>
      {field.name || id}
      {field.required ? <em> *</em> : null}
    </span>
  );

  if (t === 'choice' || t === 'product' || (Array.isArray(field.choices) && field.choices.length)) {
    return (
      <label className="dyn-field">
        {label}
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">— select —</option>
          {(field.choices || []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (t === 'integer' || t === 'percent' || t === 'decimal') {
    return (
      <label className="dyn-field">
        {label}
        <input
          type="number"
          step={t === 'integer' ? 1 : 'any'}
          min={field.min ?? undefined}
          max={field.max ?? undefined}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      </label>
    );
  }

  if (t === 'date') {
    return (
      <label className="dyn-field">
        {label}
        <input type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  }

  const inputType = t === 'email' ? 'email' : t === 'website' ? 'url' : 'text';
  return (
    <label className="dyn-field">
      {label}
      <input
        type={inputType}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        minLength={field.min ?? undefined}
        maxLength={field.max ?? undefined}
      />
    </label>
  );
}

export default function PackageForm({
  packageDetail,
  fieldValues,
  collectionValues,
  onFieldChange,
  onCollectionFieldChange,
  packageRules = [],
}) {
  if (!packageDetail) return null;

  const rootFields = packageDetail.fields || [];
  const collections = packageDetail.collections || [];

  return (
    <div className="dyn-form">
      {packageRules.length > 0 && (
        <details className="dyn-rules">
          <summary>Package rules ({packageRules.length})</summary>
          <ul>
            {packageRules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </details>
      )}

      <h3>Business & pricing</h3>
      <div className="dyn-grid">
        {rootFields.map((field) => (
          <FieldInput
            key={field.id}
            field={field}
            value={fieldValues[field.id]}
            onChange={(v) => onFieldChange(field.id, v)}
          />
        ))}
      </div>

      {collections.map((col) => {
        const records = collectionValues[col.id] || [];
        const required = Number(col.min ?? 0) >= 1;
        if (!required && records.length === 0) return null;
        return (
          <div key={col.id} className="dyn-collection">
            <h3>
              {col.name || col.id}
              {required ? ' *' : ''}
            </h3>
            {col.description && <p className="muted">{col.description}</p>}
            {records.map((rec, idx) => (
              <div key={`${col.id}-${idx}`} className="dyn-record">
                <p className="muted">Record {idx + 1}</p>
                <div className="dyn-grid">
                  {(col.fields || []).map((field) => (
                    <FieldInput
                      key={field.id}
                      field={field}
                      value={rec[field.id]}
                      onChange={(v) => onCollectionFieldChange(col.id, idx, field.id, v)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
