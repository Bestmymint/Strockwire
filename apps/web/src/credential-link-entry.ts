import { en } from "@/i18n/en";
import { th } from "@/i18n/th";

// A minimal, pre-hydration handoff for password-reset and invitation links.
// The incoming query is scrubbed before a Next.js document can serialize it.
export type CredentialLinkRoute = "/reset-password" | "/accept-invitation";

export function credentialLinkEntryHtml(route: CredentialLinkRoute): string {
  const safePath = JSON.stringify(route);
  // This pre-hydration document cannot mount the provider. Use its existing
  // preference and dictionaries without exposing the in-memory credential.
  const recoveryCopy =
    route === "/reset-password"
      ? JSON.stringify({
          en: { loading: en.loading, error: en.authResetOpenError },
          th: { loading: th.loading, error: th.authResetOpenError },
        })
      : "null";
  const noScript =
    route === "/reset-password"
      ? `${en.authResetJavascript} / ${th.authResetJavascript}`
      : "JavaScript is required to open this secure link.";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><title>StockWise</title></head>
<body><p role="status">${route === "/reset-password" ? "" : "Loading StockWise…"}</p><noscript>${noScript}</noscript>
<script>
(() => {
  const path = ${safePath};
  const tokens = new URLSearchParams(location.search).getAll('token');
  let credential = tokens.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(tokens[0])
    ? tokens[0] : null;
  history.replaceState(null, '', path);
  const copy = ${recoveryCopy};
  let text = null;
  if (copy) {
    let saved = null;
    try { saved = localStorage.getItem('stockwise.language'); } catch {}
    const language = saved === 'en' || saved === 'th' ? saved
      : navigator.language.toLowerCase().startsWith('th') ? 'th' : 'en';
    document.documentElement.lang = language;
    text = copy[language];
    document.querySelector('[role="status"]').textContent = text.loading;
  }
  const discard = () => { credential = null; };
  addEventListener('pagehide', discard);
  Object.defineProperty(window, '__stockwiseTakeCredentialLink', {
    configurable: true,
    value: () => {
      const captured = credential;
      discard();
      delete window.__stockwiseTakeCredentialLink;
      return { route: path, token: captured };
    }
  });
  fetch(path, { cache: 'no-store', credentials: 'same-origin', redirect: 'error' })
    .then(response => {
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error();
      return response.text();
    })
    .then(html => {
      // The in-memory one-use closure survives document replacement but is
      // never serialized into React, storage, the URL, or the replacement HTML.
      document.open();
      document.write(html);
      document.close();
      addEventListener('pagehide', discard);
    })
    .catch(() => {
      discard();
      delete window.__stockwiseTakeCredentialLink;
      const message = document.querySelector('[role="status"]');
      if (message) message.textContent = text ? text.error : 'Unable to open this secure link. Request a new link.';
    });
})();
</script></body></html>`;
}

export interface CredentialLinkWindow extends Window {
  __stockwiseTakeCredentialLink?: () => {
    route: CredentialLinkRoute;
    token: string | null;
  };
}
