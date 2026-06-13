import { logout } from '../api/client';
import { clearScheduledRefresh } from '../api/session';
import { useAuthStore } from '../store/auth';
import { EmptyState } from './EmptyState';

export const HomeScreen = () => {
  const user = useAuthStore((state) => state.user);

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      clearScheduledRefresh();
      useAuthStore.getState().clearSession();
    }
  };

  return (
    <main className="min-h-screen px-4 py-6 md:px-8">
      <div className="mx-auto max-w-6xl rounded-[2rem] border border-white/60 bg-white/75 p-4 shadow-shell md:p-6">
        <div className="grid gap-4 md:grid-cols-[240px_1fr]">
          <aside className="rounded-[1.75rem] bg-pine p-5 text-white">
            <p className="text-sm uppercase tracking-[0.2em] text-white/65">Session</p>
            <h1 className="mt-4 text-2xl font-semibold">Shopping Intellect</h1>
            <p className="mt-3 text-sm leading-6 text-white/75">
              {user ? `Signed in as ${user.displayName}` : 'Signed in and ready to build lists.'}
            </p>
            <button
              type="button"
              onClick={handleLogout}
              className="mt-8 rounded-2xl border border-white/20 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Sign out
            </button>
          </aside>

          <section className="rounded-[1.75rem] bg-canvas/70 p-3 md:p-5">
            <nav className="mb-4 flex items-center justify-between rounded-[1.5rem] bg-white/75 px-4 py-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-pine/70">
                  Home
                </p>
                <p className="text-sm text-ink/70">The first real screen after auth and refresh.</p>
              </div>
            </nav>
            <EmptyState context="no-lists" />
          </section>
        </div>
      </div>
    </main>
  );
};
