import { logout } from '../api/client';
import { clearScheduledRefresh } from '../api/session';
import { useAuthStore } from '../store/auth';
import { useThemeStore } from '../store/theme';
import { EmptyState } from './EmptyState';

export const HomeScreen = () => {
  const user = useAuthStore((state) => state.user);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      clearScheduledRefresh();
      useAuthStore.getState().clearSession();
    }
  };

  return (
    <main className="min-h-screen px-4 py-6 md:px-8" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto max-w-3xl space-y-4">
        <nav
          className="flex items-center justify-between px-4 py-3"
          style={{ background: 'var(--card)', borderRadius: 'var(--radius)', border: '1px solid var(--card-border)' }}
        >
          <div>
            <p style={{ color: 'var(--accent)', fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
              Shopping Intellect
            </p>
            <p style={{ color: 'var(--ink)', fontSize: 'var(--fs-h2)', fontWeight: 600 }}>
              {user ? `Signed in as ${user.displayName}` : 'Home'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex p-1" style={{ background: 'var(--card-2)', borderRadius: 'var(--radius-sm)' }}>
              <button
                type="button"
                aria-label="Светла тема"
                onClick={() => setTheme('light')}
                style={{
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--fs-xs)',
                  padding: '6px 12px',
                  fontWeight: 600,
                  background: theme === 'light' ? 'var(--accent)' : 'transparent',
                  color: theme === 'light' ? 'var(--on-accent)' : 'var(--ink-2)'
                }}
              >
                Светла
              </button>
              <button
                type="button"
                aria-label="Тъмна тема"
                onClick={() => setTheme('dark')}
                style={{
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--fs-xs)',
                  padding: '6px 12px',
                  fontWeight: 600,
                  background: theme === 'dark' ? 'var(--accent)' : 'transparent',
                  color: theme === 'dark' ? 'var(--on-accent)' : 'var(--ink-2)'
                }}
              >
                Тъмна
              </button>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="px-4 py-2 transition"
              style={{ borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', color: 'var(--ink-2)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}
            >
              Sign out
            </button>
          </div>
        </nav>

        <EmptyState context="no-lists" />
      </div>
    </main>
  );
};
