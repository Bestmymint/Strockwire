// This document deliberately has no Next router or hydration payload. Load the
// clean document only after capture: App Router serializes its request URL.
export const verificationLinkEntryHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><title>StockWise</title></head>
<body><p role="status">Loading StockWise…</p><noscript>JavaScript is required. Return to Sign in to recover verification.</noscript>
<script>
(() => {
  const tokens = new URLSearchParams(location.search).getAll('token');
  let credential = tokens.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(tokens[0])
    ? tokens[0] : null;
  history.replaceState(null, '', '/verify-email');
  const discard = () => { credential = null; };
  addEventListener('pagehide', discard);
  Object.defineProperty(window, '__stockwiseTakeVerificationLink', {
    configurable: true,
    value: () => {
      const captured = credential;
      discard();
      delete window.__stockwiseTakeVerificationLink;
      return { token: captured };
    }
  });
  fetch('/verify-email', { cache: 'no-store', credentials: 'same-origin', redirect: 'error' })
    .then(response => {
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error();
      return response.text();
    })
    .then(html => {
      // Public document APIs replace the bootstrap, not Next's private state.
      // The Window survives document.open; the one-use closure is not serialized.
      document.open();
      document.write(html);
      document.close();
      addEventListener('pagehide', discard);
    })
    .catch(() => {
      discard();
      delete window.__stockwiseTakeVerificationLink;
      document.querySelector('[role="status"]').textContent = 'Unable to load verification. Return to Sign in to recover.';
    });
})();
</script></body></html>`;

export interface VerificationLinkWindow extends Window {
  __stockwiseTakeVerificationLink?: () => { token: string | null };
}
