// With the service worker disabled (see main.tsx — it caused a Google OAuth
// race), nothing forces a stale tab to pick up a new deploy on its own. This
// polls the server's current index.html and reloads once its script tag
// (which Vite content-hashes per build) no longer matches what this tab
// loaded, so a long-lived tab/PWA session converges on the latest deploy
// within one poll interval instead of needing a manual full app-kill.
const SCRIPT_SRC_PATTERN = /<script[^>]*type="module"[^>]*src="([^"]+)"/;
const POLL_INTERVAL_MS = 5 * 60 * 1000;

const extractScriptSrc = (html: string): string | null => {
  const match = html.match(SCRIPT_SRC_PATTERN);
  return match?.[1] ?? null;
};

export const startUpdateCheck = (): void => {
  const currentScriptSrc = extractScriptSrc(document.documentElement.outerHTML);

  if (!currentScriptSrc) {
    return;
  }

  const checkForUpdate = async () => {
    try {
      const response = await fetch('/', { cache: 'no-store' });
      if (!response.ok) {
        return;
      }
      const html = await response.text();
      const latestScriptSrc = extractScriptSrc(html);

      if (latestScriptSrc && latestScriptSrc !== currentScriptSrc) {
        window.location.reload();
      }
    } catch {
      // Offline or request failed — try again next interval.
    }
  };

  window.setInterval(() => void checkForUpdate(), POLL_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkForUpdate();
    }
  });
};
