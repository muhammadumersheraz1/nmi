/**
 * Build application fields/collections from a live NMI package schema.
 * No hardcoded package field list — values come from type / choices / defaults.
 * @see GET /packages/{id} → https://docs.nmi.com/reference/getpackagebyid
 */

/** Underwriter / sandbox-only noise — never send on create. */
const SKIP_FIELD_IDS = new Set([
  'fld_special_pending_reason',
  'fld_special_reject_reason',
]);

/** Demo overrides only where schema defaults are empty (sandbox-friendly). */
const DEMO_HINTS = {
  fld_dba_name: 'Network Merchant Inc',
  fld_legal_name: 'Network Merchant Inc',
  fld_contact_name: 'Jane Doe',
  fld_dba_email: 'john@doe.com',
  fld_legal_phone_number: '8473524850',
  fld_dba_phone_number: '8473524850',
  fld_business_website: 'https://www.nmi.com/',
  fld_business_nature: 'Internet',
  fld_type_business: 'LLC',
  fld_type_of_goods_sold: 'FinTech',
  fld_pricing_type: 'Flat Rate',
  fld_mcc: '5812',
  fld_monthly_volume: 6000,
  fld_average_ticket: 50,
  fld_high_ticket: 100,
  fld_percent_of_swiped: 80,
  fld_percent_key_entered: 20,
  fld_percent_of_ecommerce: 0,
  fld_percent_of_moto: 0,
  fld_years_in_business: 2,
  fld_qual_rate: 0.1,
  fld_qual_rate_per_auth: 0.1,
  fld_cost_plus: 0,
  fld_cost_plus_per_auth: 0,
  // Schaumburg, IL — keep state/city/postal consistent (do not use choices[0]=AL)
  fld_dba_address: '1450 American Ln',
  fld_dba_city: 'Schaumburg',
  fld_dba_state: 'IL',
  fld_dba_postal_code: '60173',
  fld_dba_country: 'US',
  fld_legal_address: '1450 American Ln',
  fld_legal_city: 'Schaumburg',
  fld_legal_state: 'IL',
  fld_legal_postal_code: '60173',
  fld_legal_country: 'US',
  fld_state_incorporated: 'IL',
  fld_date_opened: '2018-01-15',
  fld_federal_tax_id: '223456789',
  // Control person = owner (valid first/last, not full "Jane Doe" in both)
  fld_individual_with_control_first_name: 'Jane',
  fld_individual_with_control_last_name: 'Doe',
  fld_individual_with_control_title: 'CEO',
  fld_individual_with_control_email: 'john@doe.com',
  fld_individual_with_control_phone: '8473524850',
  fld_individual_with_control_ssn: '003456789',
  fld_individual_with_control_dob: '1985-06-15',
  fld_individual_with_control_address: '1450 American Ln',
  fld_individual_with_control_city: 'Schaumburg',
  fld_individual_with_control_state: 'IL',
  fld_individual_with_control_postal_code: '60173',
  fld_individual_with_control_country: 'US',
  fld_individual_with_control_ownership_percentage: 100,
  fld_dda_account_number: '123456789',
  fld_dda_account_routing_number: '021000021',
  fld_dda_name_on_account: 'John Doe',
  fld_owner_first_name: 'John',
  fld_owner_last_name: 'Doe',
  fld_owner_middle_name: '',
  fld_owner_title: 'Owner',
  fld_owner_ownership_percentage: 100,
  fld_owner_email: 'john@doe.com',
  fld_owner_phone_num: '(847) 352-4850',
  fld_owner_address: '1450 American Ln',
  fld_owner_city: 'Schaumburg',
  fld_owner_state: 'IL',
  fld_owner_postal_code: '60173',
  fld_owner_country: 'US',
  fld_owner_dob: '1970-12-31',
  fld_owner_ssn: '003456789',
  fld_product_id: '32 - NMI Gateway',
};

export function buildPayloadFromPackage(packageDetail, { monthlyVolume } = {}) {
  const fields = (packageDetail.fields || [])
    .filter((f) => f?.id)
    .filter((f) => !SKIP_FIELD_IDS.has(f.id))
    .filter((f) => shouldIncludeRootField(f))
    .map((f) => ({
      id: f.id,
      value: coerceValue(f, pickDemoValue(f, monthlyVolume)),
    }))
    .filter((f) => f.value !== '' && f.value !== null && f.value !== undefined);

  const collections = (packageDetail.collections || [])
    .filter((c) => c?.id)
    .filter((c) => Number(c.min ?? 0) >= 1)
    .map((col) => ({
      id: col.id,
      records: [
        {
          id: `${String(col.id).replace(/^col_/, '')}1`,
          fields: (col.fields || [])
            .filter((f) => f?.id)
            .filter((f) => !SKIP_FIELD_IDS.has(f.id))
            .filter((f) => f.required || DEMO_HINTS[f.id] !== undefined || f.default != null)
            .map((f) => ({
              id: f.id,
              value: coerceValue(f, pickDemoValue(f, monthlyVolume)),
            }))
            .filter((f) => f.value !== '' && f.value !== null && f.value !== undefined),
        },
      ],
    }));

  return { fields, collections, package_id: packageDetail.id };
}

/** Form draft for the UI: every field/collection with a starting value. */
export function buildFormDraftFromPackage(packageDetail, { monthlyVolume } = {}) {
  const fieldValues = {};
  for (const f of packageDetail.fields || []) {
    if (!f?.id || SKIP_FIELD_IDS.has(f.id)) continue;
    // Optional passport / empty strings stay blank — do not invent "Sample"
    if (!f.required && /passport/i.test(f.id)) {
      fieldValues[f.id] = '';
      continue;
    }
    fieldValues[f.id] = coerceValue(f, pickDemoValue(f, monthlyVolume));
  }

  const collectionValues = {};
  for (const col of packageDetail.collections || []) {
    if (!col?.id) continue;
    const min = Number(col.min ?? 0);
    if (min < 1) {
      collectionValues[col.id] = [];
      continue;
    }
    const record = {};
    for (const f of col.fields || []) {
      if (!f?.id || SKIP_FIELD_IDS.has(f.id)) continue;
      const value = coerceValue(f, pickDemoValue(f, monthlyVolume));
      if (value === '' && !f.required) continue;
      record[f.id] = value;
    }
    collectionValues[col.id] = [record];
  }

  return { fieldValues, collectionValues };
}

/** Convert UI draft maps → NMI create/update payload. */
export function draftToPayload(packageDetail, fieldValues, collectionValues) {
  const fields = (packageDetail.fields || [])
    .filter((f) => f?.id)
    .filter((f) => !SKIP_FIELD_IDS.has(f.id))
    .map((f) => {
      const raw = fieldValues?.[f.id];
      if (raw === undefined || raw === null || raw === '') {
        if (!f.required) return null;
      }
      // Drop placeholder junk NMI often crashes on
      if (isJunkValue(f, raw) && !f.required) return null;
      return { id: f.id, value: coerceValue(f, sanitizeName(f, raw)) };
    })
    .filter(Boolean);

  const collections = [];
  for (const col of packageDetail.collections || []) {
    if (!col?.id) continue;
    const recordsIn = collectionValues?.[col.id] || [];
    if (!recordsIn.length) continue;
    collections.push({
      id: col.id,
      records: recordsIn.map((rec, i) => ({
        id: `${String(col.id).replace(/^col_/, '')}${i + 1}`,
        fields: (col.fields || [])
          .filter((f) => f?.id)
          .filter((f) => !SKIP_FIELD_IDS.has(f.id))
          .map((f) => {
            const raw = rec?.[f.id];
            if (raw === undefined || raw === null || raw === '') {
              if (!f.required) return null;
            }
            if (isJunkValue(f, raw) && !f.required) return null;
            return { id: f.id, value: coerceValue(f, sanitizeName(f, raw)) };
          })
          .filter(Boolean),
      })),
    });
  }

  return { fields, collections };
}

function shouldIncludeRootField(f) {
  if (SKIP_FIELD_IDS.has(f.id)) return false;
  if (/passport/i.test(f.id) && !f.required) return false;
  if (f.required) return true;
  if (DEMO_HINTS[f.id] !== undefined) return true;
  if (f.default !== undefined && f.default !== null && f.default !== '') return true;
  if (['fld_qual_rate', 'fld_qual_rate_per_auth', 'fld_business_website'].includes(f.id)) {
    return true;
  }
  return false;
}

function pickDemoValue(field, monthlyVolume) {
  if (field.id === 'fld_monthly_volume' && monthlyVolume != null) {
    return Number(monthlyVolume);
  }
  if (DEMO_HINTS[field.id] !== undefined) return DEMO_HINTS[field.id];
  if (field.default !== undefined && field.default !== null && field.default !== '') {
    return field.default;
  }
  // Prefer IL when present (matches Schaumburg demo address)
  if (Array.isArray(field.choices) && field.choices.length) {
    if (/state/i.test(field.id) && field.choices.includes('IL')) return 'IL';
    return field.choices[0];
  }
  return defaultForType(field);
}

function defaultForType(field) {
  const t = String(field.type || '').toLowerCase();
  const id = field.id || '';

  if (t === 'email' || /email/i.test(id)) return 'john@doe.com';
  if (t === 'phone' || /phone/i.test(id)) {
    return Number(field.min) >= 14 ? '(847) 352-4850' : '8473524850';
  }
  if (t === 'website') return 'https://www.nmi.com/';
  if (t === 'date' || /dob|date/i.test(id)) return '1985-06-15';
  if (t === 'ssn' || /ssn/i.test(id)) return '003456789';
  if (t === 'federal_tax_id' || /tax_id/i.test(id)) return '223456789';
  if (t === 'postal_code' || /postal|zip/i.test(id)) return '60173';
  if (t === 'routing_number') return '021000021';
  if (t === 'account_number') return '123456789';
  if (t === 'product') return Array.isArray(field.choices) ? field.choices[0] : '32 - NMI Gateway';
  if (t === 'choice') {
    if (/state/i.test(id) && Array.isArray(field.choices) && field.choices.includes('IL')) {
      return 'IL';
    }
    return Array.isArray(field.choices) ? field.choices[0] : '';
  }
  if (t === 'integer' || t === 'percent' || t === 'decimal') {
    if (/ownership/i.test(id)) return 100;
    if (field.min != null) return field.min;
    return 0;
  }
  if (/address/i.test(id)) return '1450 American Ln';
  if (/city/i.test(id)) return 'Schaumburg';
  if (/country/i.test(id)) return 'US';
  if (/state/i.test(id)) return 'IL';
  // Name parts — never put a full "Jane Doe" into first/last/middle
  if (/first_name/i.test(id)) return 'Jane';
  if (/last_name/i.test(id)) return 'Doe';
  if (/middle_name/i.test(id)) return '';
  if (/_name$/i.test(id) || /contact_name|dba_name|legal_name/i.test(id)) return 'Jane Doe';
  if (/passport/i.test(id)) return '';
  return '';
}

function isJunkValue(field, raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return true;
  if (s === 'sample') return true;
  // Full name wrongly stuffed into a first/last field
  if (/first_name|last_name|middle_name/i.test(field.id || '') && /\s/.test(s)) return true;
  return false;
}

/** Split accidental "Jane Doe" in first/last fields. */
function sanitizeName(field, raw) {
  const id = field.id || '';
  if (raw == null) return raw;
  const s = String(raw).trim();
  if (!/\s/.test(s)) return raw;
  if (/first_name/i.test(id)) return s.split(/\s+/)[0];
  if (/last_name/i.test(id)) return s.split(/\s+/).slice(-1)[0];
  if (/middle_name/i.test(id)) return '';
  return raw;
}

function coerceValue(field, raw) {
  if (raw === undefined || raw === null || raw === '') {
    if (!field.required) return '';
    return defaultForType(field);
  }
  const t = String(field.type || '').toLowerCase();
  if (t === 'integer' || t === 'percent') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (t === 'decimal') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return raw;
}

/** @deprecated use buildPayloadFromPackage — kept for older call sites */
export function sampleApproveFields() {
  return [];
}

export function sampleApproveCollections() {
  return [];
}

export function withMonthlyVolume(fields, monthlyVolume) {
  return (fields || []).map((f) =>
    f.id === 'fld_monthly_volume' ? { ...f, value: Number(monthlyVolume) } : f,
  );
}

export function filterFieldsForPackage(fields) {
  return fields;
}

export function filterCollectionsForPackage(collections) {
  return collections;
}
