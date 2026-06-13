import { useEffect, useState } from 'react';
import { refreshSession, scheduleSilentRefresh } from './api/session';
import { useAuthStore } from './store/auth';
import { useThemeStore } from './store/theme';
import { AuthScreen } from './components/AuthScreen';
import { HomeScreen } from './components/HomeScreen';
import { SkeletonLoader } from './components/SkeletonLoader';

type BootStatus = 'booting' | 'ready';

export default function App() {
  const [bootStatus, setBootStatus] = useState<BootStatus>('booting');
  const accessToken = useAuthStore((state) => state.accessToken);
  const expiresAt = useAuthStore((state) => state.expiresAt);
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    let active = true;

    const boot = async () => {
      try {
        await refreshSession();
      } catch {
        useAuthStore.getState().clearSession();
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
      {bootStatus === 'ready' && !accessToken ? <AuthScreen /> : null}
      {bootStatus === 'ready' && accessToken ? <HomeScreen /> : null}
    </div>
  );
}
