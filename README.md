# NMI docs sample

Partner + merchant playground for major [NMI docs](https://docs.nmi.com/reference/getting-started) surfaces.

The UI talks to **NMI from the browser** (no local Node API for Sign-Up):

| Tab | Needs | Network |
| --- | --- | --- |
| **Docs map** | — | local |
| **Merchants** | `NMI_PARTNER_API_KEY` | `POST /v4/merchants/reports` + `POST /v4/merchants` (partner console accounts) |
| **Sign-Up** | `NMI_CLIENT_ID` + `NMI_CLIENT_SECRET` | `https://sandbox.signup.nmi.com/api/v1/...` |
| **Pay / Customers / Transactions** | Merchants → Generate keys (session) | `http://localhost:5190/nmi-gateway/...` → `sandbox.nmi.com` (Vite proxy) |
| **Pay → 3D Secure** | Same merchant public/`collectCheckout` key | Loads `sandbox.nmi.com/js/v1/Gateway.js`, then sale with `cardholder_auth` |

## Packages vs merchants

- A **package** (`pkg_…`) is an onboarding form template on your **partner** account (Sign-Up).
- **Partner merchants** (console → Accounts) are listed/created with the **partner key** (`NMI_PARTNER_API_KEY`) — not Sign-Up `/applications`.
- Sign-Up **applications** (`app_…`) are a separate onboarding path; for Pay use **Merchants → Generate keys**.

## Flow

1. **OAuth** — `POST /oauth/token` (`client_credentials`)
2. **Packages** — `GET /packages` → `GET /packages/{id}`
3. **Create application** — `POST /applications` (+ `Idempotency-Key`)
4. **Legal consent** — `GET /applications/{id}/legal-consent` + [Consent Helper](https://docs.nmi.com/reference/legal-consent-helper)
5. **Submit** — `POST /applications/{id}/submit`
6. **Poll** — approved / declined / boarded

Sandbox base URL: `https://sandbox.signup.nmi.com/api/v1`

### Sandbox outcomes (`fld_monthly_volume`)

| Monthly volume | After submit |
| --- | --- |
| &lt; $5,000 | `application.declined` |
| $5,000 – $99,999 | `application.approved` |
| ≥ $100,000 | `application.updated.data.requested` |

## Setup

```bash
cd nmi
cp .env.example .env
# set NMI_CLIENT_ID + NMI_CLIENT_SECRET (Sign-Up)
# Pay keys: Merchants → Generate keys (optional NMI_MERCHANT_API_KEY / NMI_PUBLIC_API_KEY fallbacks)
npm install
npm run dev
```

- UI: http://127.0.0.1:5190  
- Tabs: `/docs` · `/merchants` · `/signup`  
- Per merchant (from Merchants actions): `/merchants/:id/pay` · `/merchants/:id/transactions` · `/merchants/:id/customers`  
- Open DevTools → Network → filter `signup.nmi.com` for Sign-Up traffic  

### Pay (card) — 2D vs 3D

1. Open **Pay (card)**.
2. **Authentication → 2D** — normal sale with `4111111111111111` (no challenge).
3. **Authentication → 3D Secure** on `sandbox.nmi.com` ([testing-sandbox](https://docs.nmi.com/docs/testing-sandbox)):
   - Frictionless: `4100000000000100`
   - Challenge: `4100000000005000` → code **`12345`**
   - Exp `1029`, CVV `999`
   - Regen keys so the public key has **`collectCheckout`** (Gateway.js). Console: filter `[nmi:3ds]`.
4. Optional Cardinal cards (`4000…` / exp `0830` / password `1234`) if the sandbox list is rejected.

Optional legacy Node proxy (not used by UI): `npm run dev:api`

## Docs

- [Getting Started](https://docs.nmi.com/reference/getting-started)
- [Sign-Up API](https://docs.nmi.com/reference/sign-up-api)
- [Create sale (v5)](https://docs.nmi.com/reference/create-sale-v5)
- [Query API](https://docs.nmi.com/reference/query)
- [Customers](https://docs.nmi.com/reference/list-customers-v5)
