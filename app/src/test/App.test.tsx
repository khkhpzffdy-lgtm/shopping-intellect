import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import App from '../App';
import { apiRequest } from '../api/client';
import { clearScheduledRefresh } from '../api/session';
import { clearDatabase } from '../storage/db';
import { useAuthStore } from '../store/auth';

const baseUrl = 'https://www.example.com/wp-json/si/v1';
const renderApp = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
};

const mockFetch = vi.fn<typeof fetch>();

const makeToken = (payload: Record<string, unknown>) => {
  const base64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${base64}.signature`;
};

beforeEach(async () => {
  vi.stubEnv('VITE_API_BASE_URL', baseUrl);

  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  clearScheduledRefresh();
  useAuthStore.getState().clearSession();
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  await clearDatabase();
});

afterAll(() => {
  clearScheduledRefresh();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test('boot 401 shows the auth screen', async () => {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ code: 'token_invalid' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  );

  renderApp();

  expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  expect(screen.queryByText('No lists yet')).not.toBeInTheDocument();
});

test('defaults to the dark theme with no stored preference', async () => {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ code: 'token_invalid' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  );

  const { container } = renderApp();

  await screen.findByLabelText('Email');
  expect(container.querySelector('.si-root')).toHaveAttribute('data-theme', 'dark');
});

test('boot 200 shows lists overview and keeps token out of storage', async () => {
  const accessToken = makeToken({ user_id: 42, family_ids: [7], display_name: 'Dora' });
  const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ auth: { access_token: accessToken, expires_in: 900 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  );

  renderApp();

  expect(await screen.findByText('No lists yet')).toBeInTheDocument();
  expect(useAuthStore.getState().accessToken).toBe(accessToken);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  expect(setItemSpy).not.toHaveBeenCalled();
});

test('login success shows lists overview and invalid credentials stay on auth', async () => {
  mockFetch
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'token_invalid' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'credentials_invalid' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          auth: { access_token: makeToken({ user_id: 2, family_ids: [3], display_name: 'Mila' }), expires_in: 900 },
          user: { id: 2, display_name: 'Mila', family_ids: [3] }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

  renderApp();

  await screen.findByLabelText('Email');
  await userEvent.type(screen.getByLabelText('Email'), 'mila@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'bad-pass');
  await userEvent.click(screen.getByRole('button', { name: 'Submit log in' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('credentials_invalid');

  const passwordInput = screen.getByLabelText('Password');
  await userEvent.clear(passwordInput);
  await userEvent.type(passwordInput, 'good-pass');
  await userEvent.click(screen.getByRole('button', { name: 'Submit log in' }));

  expect(await screen.findByText('No lists yet')).toBeInTheDocument();
});

test('register success shows home', async () => {
  mockFetch
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'token_invalid' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          auth: { access_token: makeToken({ user_id: 9, family_ids: [], display_name: 'Nia' }), expires_in: 900 },
          user: { id: 9, display_name: 'Nia', family_ids: [] }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

  renderApp();

  await screen.findByLabelText('Email');
  await userEvent.click(screen.getByRole('button', { name: 'Switch to register' }));
  await userEvent.type(screen.getByLabelText('Display name'), 'Nia');
  await userEvent.type(screen.getByLabelText('Email'), 'nia@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'secret123');
  await userEvent.click(screen.getByRole('button', { name: 'Submit registration' }));

  expect(await screen.findByText('No lists yet')).toBeInTheDocument();
});

test('creating a list shows it immediately and persists across remount', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 2, family_ids: [], display_name: 'Mila' }),
    expiresIn: 900,
    user: { id: 2, displayName: 'Mila', familyIds: [] }
  });

  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });

  mockFetch.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ auth: { access_token: makeToken({ user_id: 2, family_ids: [], display_name: 'Mila' }), expires_in: 900 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  );

  const view = renderApp();

  await screen.findByText('No lists yet');
  await userEvent.type(screen.getByLabelText('List name'), 'Weekly groceries');
  await userEvent.click(screen.getByRole('button', { name: 'Create list' }));

  expect(await screen.findByRole('button', { name: /Weekly groceries/i })).toBeInTheDocument();

  view.unmount();
  renderApp();

  expect(await screen.findByRole('button', { name: /Weekly groceries/i })).toBeInTheDocument();
});

test('adding, toggling, removing, and reloading items stays local-first', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 4, family_ids: [], display_name: 'Iva' }),
    expiresIn: 900,
    user: { id: 4, displayName: 'Iva', familyIds: [] }
  });

  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });

  mockFetch.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ auth: { access_token: makeToken({ user_id: 4, family_ids: [], display_name: 'Iva' }), expires_in: 900 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  );

  const view = renderApp();

  await screen.findByText('No lists yet');
  await userEvent.type(screen.getByLabelText('List name'), 'Weekend');
  await userEvent.click(screen.getByRole('button', { name: 'Create list' }));
  await userEvent.click(await screen.findByRole('button', { name: /Weekend/i }));

  await userEvent.type(screen.getByLabelText('Item term'), 'мляко');
  await userEvent.type(screen.getByLabelText('Item quantity'), '2');
  await userEvent.type(screen.getByLabelText('Item unit'), 'piece');
  await userEvent.click(screen.getByRole('button', { name: 'Add item' }));

  expect(await screen.findByText('мляко')).toBeInTheDocument();
  expect(screen.getByText('2 piece')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'shopping' }));
  const checklistRow = await screen.findByRole('button', { name: /мляко/i });
  expect(checklistRow).toHaveAttribute('aria-pressed', 'false');

  await userEvent.click(checklistRow);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /мляко/i })).toHaveAttribute('aria-pressed', 'true');
  });

  view.unmount();
  renderApp();

  await screen.findByRole('button', { name: /Weekend/i });
  await userEvent.click(screen.getByRole('button', { name: /Weekend/i }));
  expect(await screen.findByText('мляко')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'shopping' }));
  expect(await screen.findByRole('button', { name: /мляко/i })).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await waitFor(() => {
    expect(screen.queryByText('мляко')).not.toBeInTheDocument();
  });
});

test('mode toggle switches between planning and shopping rendering', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 8, family_ids: [], display_name: 'Niki' }),
    expiresIn: 900,
    user: { id: 8, displayName: 'Niki', familyIds: [] }
  });

  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });

  mockFetch.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ auth: { access_token: makeToken({ user_id: 8, family_ids: [], display_name: 'Niki' }), expires_in: 900 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  );

  renderApp();

  await screen.findByText('No lists yet');
  await userEvent.type(screen.getByLabelText('List name'), 'Switch test');
  await userEvent.click(screen.getByRole('button', { name: 'Create list' }));
  await userEvent.click(await screen.findByRole('button', { name: /Switch test/i }));
  await userEvent.type(screen.getByLabelText('Item term'), 'ябълки');
  await userEvent.click(screen.getByRole('button', { name: 'Add item' }));

  expect(await screen.findByText('Expand details soon')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'shopping' }));
  expect(screen.queryByText('Expand details soon')).not.toBeInTheDocument();
  expect(await screen.findByRole('button', { name: /ябълки/i })).toBeInTheDocument();
});

test('token_expired refreshes exactly once and retries once', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 5, family_ids: [1], display_name: 'Raya' }),
    expiresIn: 900,
    user: { id: 5, displayName: 'Raya', familyIds: [1] }
  });

  mockFetch
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'token_expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          auth: {
            access_token: makeToken({ user_id: 5, family_ids: [1], display_name: 'Raya' }),
            expires_in: 900
          }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

  const response = await apiRequest<{ ok: boolean }>('/lists', { authenticated: true });

  expect(response.ok).toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(3);
  expect(mockFetch.mock.calls[1]?.[0]).toBe(`${baseUrl}/auth/refresh`);
});

test('logout clears the store and returns to auth', async () => {
  mockFetch
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          auth: { access_token: makeToken({ user_id: 3, family_ids: [], display_name: 'Toni' }), expires_in: 900 }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));

  renderApp();

  await screen.findByText('No lists yet');
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

  await waitFor(() => {
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
  expect(await screen.findByLabelText('Email')).toBeInTheDocument();
});
