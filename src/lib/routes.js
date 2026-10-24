/**
 * Top-level tabs (nav) vs merchant-scoped tools (opened from Merchants only).
 *
 * Merchant tools: /merchants/:gatewayId/pay|transactions|customers
 */

export const VIEWS = [
  { id: 'docs', label: 'Docs map', path: '/docs' },
  { id: 'merchants', label: 'Merchants', path: '/merchants' },
  { id: 'signup', label: 'Sign-Up', path: '/signup' },
];

export const MERCHANT_TOOLS = [
  { id: 'pay', label: 'Pay (card)', segment: 'pay' },
  { id: 'transactions', label: 'Transactions', segment: 'transactions' },
  { id: 'customers', label: 'Customers', segment: 'customers' },
];

const MERCHANT_TOOL_RE = /^\/merchants\/([^/]+)\/(pay|transactions|customers)\/?$/;

export function parseLocation(pathname = window.location.pathname) {
  const p = String(pathname || '/').replace(/\/+$/, '') || '/';
  if (p === '/' || p === '') {
    return { view: 'docs', merchantId: null, tool: null };
  }

  // Old top-level tool URLs → treat as merchants list (no orphan tools).
  if (p === '/pay' || p === '/transactions' || p === '/customers') {
    return { view: 'merchants', merchantId: null, tool: null, redirect: '/merchants' };
  }

  const toolMatch = p.match(MERCHANT_TOOL_RE);
  if (toolMatch) {
    return {
      view: 'merchant-tool',
      merchantId: decodeURIComponent(toolMatch[1]),
      tool: toolMatch[2],
    };
  }

  const hit = VIEWS.find((v) => v.path === p);
  if (hit) {
    return { view: hit.id, merchantId: null, tool: null };
  }

  if (p.startsWith('/merchants/')) {
    return { view: 'merchants', merchantId: null, tool: null, redirect: '/merchants' };
  }

  return { view: 'docs', merchantId: null, tool: null };
}

export function viewFromPath(pathname = window.location.pathname) {
  return parseLocation(pathname).view;
}

export function pathForView(viewId) {
  const hit = VIEWS.find((v) => v.id === viewId);
  return hit?.path || '/docs';
}

export function pathForMerchantTool(merchantId, tool) {
  const t = MERCHANT_TOOLS.find((x) => x.id === tool || x.segment === tool);
  const segment = t?.segment || 'pay';
  return `/merchants/${encodeURIComponent(merchantId)}/${segment}`;
}

/** App listens for this (and popstate) so pushState navigations re-render. */
export function notifyRouteChange() {
  window.dispatchEvent(new CustomEvent('nmi:navigate'));
}

export function navigateToView(viewId, { replace = false } = {}) {
  const path = pathForView(viewId);
  if (window.location.pathname !== path) {
    if (replace) window.history.replaceState({ view: viewId }, '', path);
    else window.history.pushState({ view: viewId }, '', path);
  }
  notifyRouteChange();
  return path;
}

export function navigateToMerchantTool(merchantId, tool, { replace = false } = {}) {
  const path = pathForMerchantTool(merchantId, tool);
  const state = { view: 'merchant-tool', merchantId, tool };
  if (window.location.pathname !== path) {
    if (replace) window.history.replaceState(state, '', path);
    else window.history.pushState(state, '', path);
  }
  notifyRouteChange();
  return path;
}
