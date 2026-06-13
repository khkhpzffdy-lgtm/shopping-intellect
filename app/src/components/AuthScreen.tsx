import { FormEvent, useState } from 'react';
import { ApiError } from '../api/session';
import { login, register } from '../api/client';
import { applyAuthEnvelope, normalizeSessionUser, scheduleSilentRefresh } from '../api/session';

type Mode = 'login' | 'register';

export const AuthScreen = () => {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitLabel = mode === 'login' ? 'Log in' : 'Create account';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response =
        mode === 'login'
          ? await login({ email, password })
          : await register({ email, password, display_name: displayName });

      applyAuthEnvelope(response, normalizeSessionUser(response));
      scheduleSilentRefresh(Date.now() + response.auth.expires_in * 1000);
    } catch (submissionError) {
      if (submissionError instanceof ApiError) {
        setError(submissionError.code ?? submissionError.message);
      } else {
        setError('network_error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-5xl gap-6 rounded-[2rem] border border-white/60 bg-white/80 p-6 shadow-shell md:grid-cols-[1.1fr_0.9fr] md:p-8">
        <section className="rounded-[1.75rem] bg-pine p-8 text-white">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/70">
            Shopping Intellect
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight">
            A fast shell that keeps the session in memory and the refresh token in the cookie.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-white/78">
            Register or log in to land on the empty home state. Reloading the page should keep
            you inside the app without ever writing the access token to browser storage.
          </p>
          <div className="mt-10 rounded-[1.5rem] border border-white/20 bg-white/10 p-5">
            <p className="text-sm uppercase tracking-[0.2em] text-white/65">Soon</p>
            <p className="mt-2 text-lg font-medium">Sign in with Google</p>
            <p className="mt-2 text-sm text-white/70">Visual placeholder only in this slice.</p>
          </div>
        </section>

        <section className="rounded-[1.75rem] bg-canvas/70 p-6">
          <div className="inline-flex rounded-full bg-white p-1 shadow-sm">
            <button
              type="button"
              aria-label="Switch to log in"
              onClick={() => setMode('login')}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                mode === 'login' ? 'bg-pine text-white' : 'text-ink/70'
              }`}
            >
              Log in
            </button>
            <button
              type="button"
              aria-label="Switch to register"
              onClick={() => setMode('register')}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                mode === 'register' ? 'bg-pine text-white' : 'text-ink/70'
              }`}
            >
              Register
            </button>
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            {mode === 'register' ? (
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-ink">Display name</span>
                <input
                  required
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="w-full rounded-2xl border border-pine/15 bg-white px-4 py-3 text-base outline-none transition focus:border-pine"
                />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-ink">Email</span>
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-2xl border border-pine/15 bg-white px-4 py-3 text-base outline-none transition focus:border-pine"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-ink">Password</span>
              <input
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-pine/15 bg-white px-4 py-3 text-base outline-none transition focus:border-pine"
              />
            </label>

            {error ? (
              <p role="alert" className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-medium text-coral">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              aria-label={mode === 'login' ? 'Submit log in' : 'Submit registration'}
              disabled={isSubmitting}
              className="w-full rounded-2xl bg-pine px-4 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? 'Working...' : submitLabel}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
};
