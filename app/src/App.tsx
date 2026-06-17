import { useEffect, useState } from 'react';
import { loginWithGoogle } from './api/client';
import { ApiError } from './api/session';
import type { ShoppingListRecord } from './storage/db';
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
import { BottomNav } from './components/BottomNav';
import { AddSearchScreen } from './components/AddSearchScreen';
import { SkeletonLoader } from './components/SkeletonLoader';

type BootStatus = 'booting' | 'ready';
type ActiveTab = 'lists' | 'add';

const isTokenExpiredOrMissing = (expiresAt: number | null) =>
  expiresAt === null || Date.now() >= expiresAt - 30_000;

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export default function App() {
  const [bootStatus, setBootStatus] = useState<BootStatus>('booting');
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('lists');
  const [selectedListRecord, setSelectedListRecord] = useState<ShoppingListRecord | null>(null);
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
          if (active) setBootStatus('ready');
          return;
        } catch (error) {
          if (error instanceof ApiError) {
            const detailMessage = error.details
              ? Object.entries(error.details).map(([k, v]) => `${k}: ${v}`).join(', ')
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

      // In-memory token still valid — no refresh needed.
      if (useAuthStore.getState().accessToken) {
        if (active) setBootStatus('ready');
        return;
      }

      // Handoff from a recent login/redirect (sessionStorage, TTL 10 min).
      const handoff = consumeAuthHandoff();
      if (handoff) {
        applyAuthEnvelope(handoff, normalizeSessionUser(handoff));
        scheduleSilentRefresh(Date.now() + handoff.auth.expires_in * 1000);
        noteAuthBreadcrumb('restored session from handoff');
        if (active) setBootStatus('ready');
        return;
      }

      // Try to restore from httpOnly refresh cookie.
      // On failure we land on the auth screen — but ONLY for explicit auth errors
      // (token_invalid / token_reuse_detected). Network errors leave the user logged
      // in so a brief offline moment or slow connection never forces a re-login.
      try {
        await refreshSession();
      } catch (firstError) {
        noteAuthBreadcrumb(
          `refresh failed on boot: ${firstError instanceof Error ? firstError.message : 'unknown'}`
        );

        const isAuthError =
          firstError instanceof ApiError &&
          (firstError.code === 'token_invalid' || firstError.code === 'token_reuse_detected');

        if (!isAuthError) {
          // Network/server error — retry once after a short pause.
          try {
            await wait(350);
            await refreshSession();
          } catch (secondError) {
            noteAuthBreadcrumb(
              `refresh retry failed on boot: ${secondError instanceof Error ? secondError.message : 'unknown'}`
            );
            const isAuthError2 =
              secondError instanceof ApiError &&
              (secondError.code === 'token_invalid' || secondError.code === 'token_reuse_detected');
            // Only clear the session for definitive auth rejections, not network errors.
            if (isAuthError2) {
              useAuthStore.getState().clearSession();
            }
            // If it's a network error the user stays "logged in" in the UI;
            // the silent-refresh timer or visibilitychange will retry later.
          }
        } else {
          useAuthStore.getState().clearSession();
        }
      } finally {
        if (active) setBootStatus('ready');
      }
    };

    void boot();

    return () => { active = false; };
  }, []);

  // Re-schedule silent refresh whenever the token changes.
  useEffect(() => {
    if (accessToken) {
      scheduleSilentRefresh(expiresAt);
    }
  }, [accessToken, expiresAt]);

  // Proactive refresh when the user comes back to the tab / app after a pause.
  // This is the main guard against iOS background killing the setTimeout.
  useEffect(() => {
    const tryRefresh = () => {
      if (!useAuthStore.getState().accessToken) return;
      if (!isTokenExpiredOrMissing(useAuthStore.getState().expiresAt)) return;
      noteAuthBreadcrumb('proactive refresh on visibility/focus');
      void refreshSession().catch(() => {
        // silent — the next API call will get a 401 and re-trigger refresh
      });
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') tryRefresh();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', tryRefresh);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', tryRefresh);
    };
  }, []);

  const isLoggedIn = bootStatus === 'ready' && !!accessToken;

  return (
    <div className="si-root min-h-screen" data-theme={theme} style={{ paddingBottom: isLoggedIn ? 64 : 0 }}>
      {bootStatus === 'booting' ? (
        <div className="px-4 py-6 md:px-8"><SkeletonLoader shape="card" /></div>
      ) : null}
      {bootStatus === 'ready' && !accessToken ? (
        <div className="px-4 py-6 md:px-8"><AuthScreen initialError={authError} /></div>
      ) : null}
      {isLoggedIn ? (
        <>
          <div style={{ display: activeTab === 'lists' ? 'block' : 'none' }}>
            <HomeScreen
              onOpenAddSearch={(list) => {
                setSelectedListRecord(list);
                setActiveTab('add');
              }}
              onItemAdded={() => {}}
            />
          </div>
          <div style={{ display: activeTab === 'add' ? 'block' : 'none' }} className="px-4 py-4 md:px-8">
            <AddSearchScreen
              selectedList={selectedListRecord}
              onItemAdded={() => setActiveTab('lists')}
              isActive={activeTab === 'add'}
            />
          </div>
          <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
        </>
      ) : null}
    </div>
  );
}
