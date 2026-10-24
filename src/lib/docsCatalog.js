/**
 * NMI docs feature map — what this sample covers vs docs-only.
 * Source: https://docs.nmi.com/llms.txt / https://docs.nmi.com/reference/getting-started
 */
export const DOCS_CATALOG = [
  {
    area: 'Merchant Sign-Up',
    docs: 'https://docs.nmi.com/reference/sign-up-api',
    sample: 'signup',
    items: [
      { name: 'OAuth access token', status: 'done', href: 'https://docs.nmi.com/reference/getaccesstoken' },
      { name: 'List / get packages', status: 'done', href: 'https://docs.nmi.com/reference/getpackages' },
      { name: 'Create / update / submit application', status: 'done', href: 'https://docs.nmi.com/reference/createapplication' },
      { name: 'Legal consent helper', status: 'done', href: 'https://docs.nmi.com/reference/legal-consent-helper' },
      { name: 'List applications + poll status', status: 'done', href: 'https://docs.nmi.com/reference/getapplications' },
      { name: 'Webhook receiver', status: 'partial', href: 'https://docs.nmi.com/reference/msu-webhook-subscriptions' },
      { name: 'Upload documents', status: 'docs', href: 'https://docs.nmi.com/reference/uploaddocument' },
    ],
  },
  {
    area: 'Online Payments (REST v5)',
    docs: 'https://docs.nmi.com/reference/create-sale-v5',
    sample: 'merchants',
    items: [
      { name: 'Sale (card)', status: 'done', href: 'https://docs.nmi.com/reference/create-sale-v5' },
      { name: 'Auth / Capture / Void / Refund', status: 'done', href: 'https://docs.nmi.com/reference/create-auth-v5' },
      { name: 'Get payment by ID', status: 'done', href: 'https://docs.nmi.com/reference/get-payment-v5' },
      {
        name: '2D vs 3D Secure (Gateway.js + cardholder_auth)',
        status: 'done',
        href: 'https://docs.nmi.com/docs/payer-authentication-3ds',
      },
      { name: 'Payment Component / Collect.js (browser tokenization)', status: 'docs', href: 'https://docs.nmi.com/docs/payment-component' },
      { name: 'Apple Pay / Google Pay', status: 'docs', href: 'https://docs.nmi.com/docs/digital-wallet-setup' },
    ],
  },
  {
    area: 'Customers (Vault)',
    docs: 'https://docs.nmi.com/reference/list-customers-v5',
    sample: 'merchants',
    items: [
      { name: 'List / create / get customers', status: 'done', href: 'https://docs.nmi.com/reference/create-customer-v5' },
      { name: 'Billing / shipping address APIs', status: 'docs', href: 'https://docs.nmi.com/reference/add-billing-address-v5' },
      { name: 'Sale using vault token', status: 'partial', href: 'https://docs.nmi.com/docs/using-for-transactions' },
    ],
  },
  {
    area: 'Reporting / Transactions',
    docs: 'https://docs.nmi.com/reference/query',
    sample: 'merchants',
    items: [
      { name: 'Classic Query API (transaction list)', status: 'done', href: 'https://docs.nmi.com/reference/query' },
      { name: 'Partner transaction query', status: 'docs', href: 'https://docs.nmi.com/reference/get-transaction-data' },
      { name: 'Invoices / plans / subscriptions', status: 'docs', href: 'https://docs.nmi.com/reference/list-invoices-v5' },
    ],
  },
  {
    area: 'Account Management / In-person / Admin',
    docs: 'https://docs.nmi.com/reference/getting-started',
    sample: 'merchants',
    items: [
      { name: 'Partner merchant list', status: 'done', href: 'https://docs.nmi.com/reference/get-merchant-list' },
      { name: 'Create merchant under partner', status: 'done', href: 'https://docs.nmi.com/reference/create-merchant' },
      { name: 'Delete merchant under partner', status: 'done', href: 'https://docs.nmi.com/reference/get-merchant-list' },
      { name: 'Create merchant security keys', status: 'done', href: 'https://docs.nmi.com/reference/create-merchant-key' },
      { name: 'Cloud devices / Tap to Pay', status: 'docs', href: 'https://docs.nmi.com/docs/in-person-payments-overview' },
      { name: 'Gateway webhooks', status: 'docs', href: 'https://docs.nmi.com/reference/overview' },
    ],
  },
];
