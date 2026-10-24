import { useEffect, useId, useRef } from 'react';

const HELPER_SRC = 'https://sandbox.signup.nmi.com/build/consent-helper-1.0.0.umd.js';

function loadHelperScript() {
  if (window.LegalConsent) return Promise.resolve();
  const existing = document.querySelector(`script[src="${HELPER_SRC}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load LegalConsent helper')));
      if (window.LegalConsent) resolve();
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = HELPER_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load LegalConsent helper'));
    document.body.appendChild(script);
  });
}

/**
 * Embeds NMI Legal Consent widget.
 * @see https://docs.nmi.com/reference/legal-consent-helper
 */
export default function ConsentEmbed({ consentUrl, onAccepted, onError }) {
  const reactId = useId().replace(/:/g, '');
  const containerId = `nmi-consent-${reactId}`;
  const acceptedRef = useRef(onAccepted);
  const errorRef = useRef(onError);
  acceptedRef.current = onAccepted;
  errorRef.current = onError;

  useEffect(() => {
    if (!consentUrl) return undefined;
    let cancelled = false;

    (async () => {
      try {
        await loadHelperScript();
        if (cancelled || !window.LegalConsent) return;
        window.LegalConsent.destroy?.();
        // NMI consent UI is light-themed (dark text). Use a white overlay so it
        // stays readable on our dark app chrome — transparent makes it "all black".
        window.LegalConsent.load(
          consentUrl,
          { selector: `#${containerId}`, overlay: '#ffffff' },
          {
            onAccepted: ({ accepted }) => acceptedRef.current?.(Boolean(accepted)),
            onError: ({ message }) => errorRef.current?.(message || 'Consent error'),
          },
        );
      } catch (err) {
        errorRef.current?.(err.message || 'Could not load consent');
      }
    })();

    return () => {
      cancelled = true;
      try {
        window.LegalConsent?.destroy?.();
      } catch {
        /* ignore */
      }
    };
  }, [consentUrl, containerId]);

  return <div id={containerId} className="consent-frame" />;
}
