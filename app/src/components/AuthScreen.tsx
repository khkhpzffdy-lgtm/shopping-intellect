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

  const submitLabel = mode === 'login' ? 'Вход' : 'Регистрация';

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

  const inputStyle = {
    background: 'var(--input)',
    borderColor: 'var(--line)',
    color: 'var(--ink)',
    borderRadius: 'var(--radius-sm)'
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10" style={{ background: 'var(--bg)' }}>
      <div
        className="w-full max-w-md p-6"
        style={{ background: 'var(--card)', borderRadius: 'var(--radius)', border: '1px solid var(--card-border)', boxShadow: 'var(--shadow)' }}
      >
        <p style={{ color: 'var(--accent)', fontSize: 'var(--fs-sm)', fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
          Shopping Intellect
        </p>
        <h1 className="mt-2" style={{ color: 'var(--ink)', fontSize: 'var(--fs-h1)', fontWeight: 600 }}>
          {mode === 'login' ? 'Вход в профила' : 'Създаване на профил'}
        </h1>

        <div className="mt-5 inline-flex p-1" style={{ background: 'var(--card-2)', borderRadius: 'var(--radius-sm)' }}>
          <button
            type="button"
            aria-label="Switch to log in"
            onClick={() => setMode('login')}
            style={{
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--fs-sm)',
              padding: '8px 16px',
              fontWeight: 600,
              background: mode === 'login' ? 'var(--accent)' : 'transparent',
              color: mode === 'login' ? 'var(--on-accent)' : 'var(--ink-2)'
            }}
          >
            Вход
          </button>
          <button
            type="button"
            aria-label="Switch to register"
            onClick={() => setMode('register')}
            style={{
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--fs-sm)',
              padding: '8px 16px',
              fontWeight: 600,
              background: mode === 'register' ? 'var(--accent)' : 'transparent',
              color: mode === 'register' ? 'var(--on-accent)' : 'var(--ink-2)'
            }}
          >
            Регистрация
          </button>
        </div>

        <form className="mt-5 space-y-3" onSubmit={handleSubmit}>
          {mode === 'register' ? (
            <label className="block">
              <span className="mb-1 block" style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>Display name</span>
              <input
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="w-full border px-4 py-3 outline-none transition"
                style={inputStyle}
              />
            </label>
          ) : null}

          <label className="block">
            <span className="mb-1 block" style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>Email</span>
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full border px-4 py-3 outline-none transition"
              style={inputStyle}
            />
          </label>

          <label className="block">
            <span className="mb-1 block" style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>Password</span>
            <input
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full border px-4 py-3 outline-none transition"
              style={inputStyle}
            />
          </label>

          {error ? (
            <p
              role="alert"
              className="px-4 py-3"
              style={{ borderRadius: 'var(--radius-sm)', background: 'color-mix(in srgb, var(--danger) 16%, var(--card))', color: 'var(--danger)', fontSize: 'var(--fs-sm)', fontWeight: 500 }}
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            aria-label={mode === 'login' ? 'Submit log in' : 'Submit registration'}
            disabled={isSubmitting}
            className="w-full px-4 py-3 transition disabled:cursor-not-allowed disabled:opacity-70"
            style={{ borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: 'var(--on-accent)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}
          >
            {isSubmitting ? 'Моля, изчакайте...' : submitLabel}
          </button>
        </form>
      </div>
    </main>
  );
};
