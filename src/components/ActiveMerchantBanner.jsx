import { getActiveMerchant, maskKey } from '../lib/merchantSession.js';
import { navigateToView } from '../lib/routes.js';

/** Shows which merchant Pay / Transactions / Customers are using. */
export default function ActiveMerchantBanner() {
  const active = getActiveMerchant();

  if (active?.privateKey) {
    return (
      <div className="banner ok-soft">
        Merchant <strong>{active.company || active.merchantId}</strong> · gateway{' '}
        <code>{active.merchantId}</code> · key <code>{maskKey(active.privateKey)}</code>
        {active.publicKey ? (
          <>
            {' '}
            · public <code>{maskKey(active.publicKey)}</code>
          </>
        ) : null}
        .{' '}
        <button type="button" className="link-button" onClick={() => navigateToView('merchants')}>
          ← Back to Merchants
        </button>
      </div>
    );
  }

  return (
    <div className="banner warn">
      No keys for this merchant. Go back to{' '}
      <button type="button" className="link-button" onClick={() => navigateToView('merchants')}>
        Merchants
      </button>{' '}
      and click <strong>Generate keys</strong> first.
    </div>
  );
}
