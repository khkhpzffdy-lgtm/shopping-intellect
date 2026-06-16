import { useEffect, useState } from 'react';
import { loginWithGoogle } from './api/client';
import { ApiError } from './api/session';
import {
  applyAuthEnvelope,
  consumeAuthHandoff,
  clearAuthHandoff,
  googleRedirectUri,
  normalizeSessionUser,
  noteAuthBreadcrumb,
  refreshSession,
  saveAuthHandoff,
  scheduleSilentRefresh
} from './api/session';
import { useAuthStore } from './store/auth';
import { useThemeStore } from './store/theme';
import { AuthScreen } from './components/AuthScreen';
import { HomeScreen } from './components/HomeScreen';
import { SkeletonLoader } from './components/SkeletonLoader';

type BootStatus = 'booting' | 'ready';

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export default function App() {
  const [bootStatus, setBootStatus] = useState<BootStatus>('booting');
  const [authError, setAuthError] = useState<string | null>(null);
  const accessToken = useAuthStore((state) => state.accessToken);
  const expiresAt = useAuthStore((state) => state.expiresAt);
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    let active = true;

    const boot = async () => {
      noteAuthBreadcrumb('boot started');
      setAuthError(null);
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');

      if (code) {
        params.delete('code');
        params.delete('scope');
        params.delete('state');
        const query = params.toString();
        window.history.replaceState(
          {},
          '',
          window.location.pathname + (query ? `?${query}` : '')
        );

        try {
          noteAuthBreadcrumb('google callback detected');
          const response = await loginWithGoogle({ code, redirect_uri: googleRedirectUri() });
          saveAuthHandoff(response);
          applyAuthEnvelope(response, normalizeSessionUser(response));
          scheduleSilentRefresh(Date.now() + response.auth.expires_in * 1000);
          noteAuthBreadcrumb('google login succeeded');
          if (active) {
            setBootStatus('ready');
          }
          return;
        } catch (error) {
          if (error instanceof ApiError) {
            const detailMessage = error.details
              ? Object.entries(error.details)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(', ')
              : null;

            noteAuthBreadcrumb(`google login failed: ${detailMessage ?? error.message}`);
            setAuthError(detailMessage ? `Google login failed (${detailMessage})` : `Google login failed (${error.message})`);
          } else {
            noteAuthBreadcrumb('google login failed: network error');
            setAuthError('Google login failed (network error)');
          }

          clearAuthHandoff();
          useAuthStore.getState().clearSession();
        }
      }

      // After an OAuth callback, React can re-run boot while the in-memory access
      // token is already set but before any cookie-based refresh is needed.
      if (useAuthStore.getState().accessToken) {
        if (active) {
          setBootStatus('ready');
        }
        return;
      }

      const handoff = consumeAuthHandoff();
      if (handoff) {
        applyAuthEnvelope(handoff, normalizeSessionUser(handoff));
        scheduleSilentRefresh(Date.now() + handoff.auth.expires_in * 1000);
        noteAuthBreadcrumb('restored session from handoff');
        if (active) {
          setBootStatus('ready');
        }
        return;
      }

      try {
        await refreshSession();
      } catch (firstError) {
        noteAuthBreadcrumb(
          `refresh failed on boot: ${firstError instanceof Error ? firstError.message : 'unknown'}`
        );

        try {
          await wait(350);
          await refreshSession();
        } catch (secondError) {
          noteAuthBreadcrumb(
            `refresh retry failed on boot: ${secondError instanceof Error ? secondError.message : 'unknown'}`
          );
          useAuthStore.getState().clearSession();
        }
      } finally {
        if (active) {
          setBootStatus('ready');
        }
      }
    };

    void boot();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (accessToken) {
      scheduleSilentRefresh(expiresAt);
    }
  }, [accessToken, expiresAt]);

  return (
    <div className="si-root min-h-screen px-4 py-6 md:px-8" data-theme={theme}>
      {bootStatus === 'booting' ? <SkeletonLoader shape="card" /> : null}
      {bootStatus === 'ready' && !accessToken ? <AuthScreen initialError={authError} /> : null}
      {bootStatus === 'ready' && accessToken ? <HomeScreen /> : null}
    </div>
  );
}
