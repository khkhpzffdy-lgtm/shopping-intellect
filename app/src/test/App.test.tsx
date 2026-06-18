import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import App from '../App';
import { apiRequest } from '../api/client';
import { clearScheduledRefresh } from '../api/session';
import { clearDatabase, enqueueMutation, putList } from '../storage/db';
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
  expect(screen.queryByText('Все още нямаш списъци')).not.toBeInTheDocument();
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

  expect(await screen.findByText('Все още нямаш списъци')).toBeInTheDocument();
  expect(useAuthStore.getState().accessToken).toBe(accessToken);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  expect(setItemSpy).not.toHaveBeenCalled();
});

test('boot restores a recent auth handoff without calling refresh first', async () => {
  const accessToken = makeToken({ user_id: 42, family_ids: [7], display_name: 'Dora' });

  sessionStorage.setItem(
    'si_auth_handoff_v1',
    JSON.stringify({
      saved_at: Date.now(),
      envelope: {
        auth: { access_token: accessToken, expires_in: 900 },
        user: { id: 42, display_name: 'Dora', family_ids: [7] }
      }
    })
  );

  renderApp();

  expect(await screen.findByText('Все още нямаш списъци')).toBeInTheDocument();
  expect(useAuthStore.getState().accessToken).toBe(accessToken);
  expect(mockFetch).not.toHaveBeenCalled();
});

test('boot retries refresh once before logging out', async () => {
  const accessToken = makeToken({ user_id: 42, family_ids: [], display_name: 'Dora' });

  vi.useFakeTimers();
  mockFetch
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'token_invalid', message: 'No refresh token present.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ auth: { access_token: accessToken, expires_in: 900 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

  renderApp();

  await vi.advanceTimersByTimeAsync(400);

  expect(await screen.findByText('Все още нямаш списъци')).toBeInTheDocument();
  expect(mockFetch).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
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

  expect(await screen.findByText('Все още нямаш списъци')).toBeInTheDocument();
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

  expect(await screen.findByText('Все още нямаш списъци')).toBeInTheDocument();
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

  await screen.findByText('Все още нямаш списъци');
  await userEvent.type(screen.getByLabelText('List name'), 'Weekly groceries');
  await userEvent.click(screen.getByRole('button', { name: 'Създай списък' }));

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

  await screen.findByText('Все още нямаш списъци');
  await userEvent.type(screen.getByLabelText('List name'), 'Weekend');
  await userEvent.click(screen.getByRole('button', { name: 'Създай списък' }));
  await userEvent.click(await screen.findByRole('button', { name: /Weekend/i }));

  await userEvent.type(screen.getByLabelText('Item term'), 'мляко');
  await userEvent.type(screen.getByLabelText('Item quantity'), '2');
  await userEvent.type(screen.getByLabelText('Item unit'), 'бр.');
  await userEvent.click(screen.getByRole('button', { name: 'Add item' }));

  expect(await screen.findByText('мляко')).toBeInTheDocument();
  expect(screen.getByText('2 бр.')).toBeInTheDocument();

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
  await userEvent.click(screen.getByRole('button', { name: 'Премахни' }));
  await waitFor(() => {
    expect(screen.queryByText('мляко')).not.toBeInTheDocument();
  });
});

test('adding an item to a list whose create-list mutation has not resolved still attempts to sync', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 6, family_ids: [], display_name: 'Vera' }),
    expiresIn: 900,
    user: { id: 6, displayName: 'Vera', familyIds: [] }
  });

  // The create-list POST never resolves, so the list never gets a server id.
  mockFetch.mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.endsWith('/lists')) {
      return new Promise(() => {});
    }
    return Promise.resolve(
      new Response(JSON.stringify({ item: { id: 'srv-item-1' }, user_product: { id: 'srv-product-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
  });

  renderApp();

  await screen.findByText('Все още нямаш списъци');
  await userEvent.click(screen.getByRole('button', { name: 'New list' }));
  await userEvent.type(screen.getByLabelText('List name'), 'Pending list');
  await userEvent.click(screen.getByRole('button', { name: 'Създай списък' }));

  await userEvent.click(await screen.findByRole('button', { name: /Pending list/i }));
  await userEvent.type(screen.getByLabelText('Item term'), 'мляко');
  await userEvent.click(screen.getByRole('button', { name: 'Add item' }));

  expect(await screen.findByText('мляко')).toBeInTheDocument();

  await waitFor(() => {
    const itemPostCall = mockFetch.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      return url.includes('/items') && (init as RequestInit | undefined)?.method === 'POST';
    });
    expect(itemPostCall).toBeDefined();
  });
});

test('creating a list and adding an item while offline does not surface an error', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 7, family_ids: [], display_name: 'Petar' }),
    expiresIn: 900,
    user: { id: 7, displayName: 'Petar', familyIds: [] }
  });

  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
  mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

  renderApp();

  await screen.findByText('Все още нямаш списъци');
  await userEvent.click(screen.getByRole('button', { name: 'New list' }));
  await userEvent.type(screen.getByLabelText('List name'), 'Offline list');
  await userEvent.click(screen.getByRole('button', { name: 'Създай списък' }));

  expect(await screen.findByRole('button', { name: /Offline list/i })).toBeInTheDocument();
  expect(screen.queryByText(/Списъкът не може да се създаде/i)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /Offline list/i }));
  await userEvent.type(screen.getByLabelText('Item term'), 'мляко');
  await userEvent.click(screen.getByRole('button', { name: 'Add item' }));

  expect(await screen.findByText('мляко')).toBeInTheDocument();
  expect(screen.queryByText(/Продуктът не може да се добави/i)).not.toBeInTheDocument();
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

  await screen.findByText('Все още нямаш списъци');
  await userEvent.type(screen.getByLabelText('List name'), 'Switch test');
  await userEvent.click(screen.getByRole('button', { name: 'Създай списък' }));
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

  await screen.findByText('Все още нямаш списъци');
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

  await waitFor(() => {
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
  expect(await screen.findByLabelText('Email')).toBeInTheDocument();
});

test('boot pulls a list from the server that does not exist in local IndexedDB yet', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 10, family_ids: [], display_name: 'Boris' }),
    expiresIn: 900,
    user: { id: 10, displayName: 'Boris', familyIds: [] }
  });

  mockFetch.mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.endsWith('/auth/refresh')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ auth: { access_token: makeToken({ user_id: 10, family_ids: [], display_name: 'Boris' }), expires_in: 900 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    }

    if (url.endsWith('/lists')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            lists: [
              {
                id: '900',
                client_uuid: 'server-list-uuid-1',
                name: 'Server-only list',
                owner_type: 'user',
                owner_id: '10',
                updated_at: '2026-06-17T10:00:00.000Z'
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    }

    return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });

  renderApp();

  expect(await screen.findByRole('button', { name: /Server-only list/i })).toBeInTheDocument();
});

test('boot pull does not overwrite a local list with a pending mutation queued against it', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 11, family_ids: [], display_name: 'Galya' }),
    expiresIn: 900,
    user: { id: 11, displayName: 'Galya', familyIds: [] }
  });

  await putList({
    client_uuid: 'local-list-uuid-1',
    name: 'My local edit',
    owner_type: 'user',
    owner_id: 11,
    updated_at: '2026-06-17T12:00:00.000Z'
  });
  await enqueueMutation({
    client_uuid: 'mutation-uuid-1',
    endpoint: '/lists',
    method: 'POST',
    body: { name: 'My local edit' },
    created_at: '2026-06-17T12:00:00.000Z',
    attempts: 0,
    status: 'pending',
    entity_client_uuid: 'local-list-uuid-1'
  });

  mockFetch.mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.endsWith('/auth/refresh')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ auth: { access_token: makeToken({ user_id: 11, family_ids: [], display_name: 'Galya' }), expires_in: 900 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    }

    if (url.endsWith('/lists')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            lists: [
              {
                id: '901',
                client_uuid: 'local-list-uuid-1',
                name: 'Stale server name',
                owner_type: 'user',
                owner_id: '11',
                updated_at: '2026-06-10T00:00:00.000Z'
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    }

    return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });

  renderApp();

  expect(await screen.findByRole('button', { name: /My local edit/i })).toBeInTheDocument();
  expect(screen.queryByText(/Stale server name/i)).not.toBeInTheDocument();
});

test('opening a list pulls its items from the server when local IndexedDB has none', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 13, family_ids: [], display_name: 'Elena' }),
    expiresIn: 900,
    user: { id: 13, displayName: 'Elena', familyIds: [] }
  });

  await putList({
    client_uuid: 'synced-list-uuid-1',
    id: '902',
    name: 'Synced list',
    owner_type: 'user',
    owner_id: 13,
    updated_at: '2026-06-17T12:00:00.000Z'
  });

  mockFetch.mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.endsWith('/auth/refresh')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ auth: { access_token: makeToken({ user_id: 13, family_ids: [], display_name: 'Elena' }), expires_in: 900 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    }

    if (url.endsWith('/lists')) {
      return Promise.resolve(new Response(JSON.stringify({ lists: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }

    if (url.endsWith('/lists/902')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            list: { id: '902', client_uuid: 'synced-list-uuid-1', name: 'Synced list', owner_type: 'user', owner_id: '13', updated_at: '2026-06-17T12:00:00.000Z' },
            items: [
              {
                id: '700',
                client_uuid: 'server-item-uuid-1',
                list_id: '902',
                user_product_id: 'up-700',
                quantity: 3,
                unit: 'бр.',
                is_checked: false,
                updated_at: '2026-06-17T12:00:00.000Z',
                term: 'кашкавал'
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    }

    return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });

  renderApp();

  await userEvent.click(await screen.findByRole('button', { name: /Synced list/i }));

  expect(await screen.findByText('кашкавал')).toBeInTheDocument();
});

test('the 🔍 button opens Add/Search as an overlay on the list and closing it returns to the same list', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 14, family_ids: [], display_name: 'Yana' }),
    expiresIn: 900,
    user: { id: 14, displayName: 'Yana', familyIds: [] }
  });

  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });

  mockFetch.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ auth: { access_token: makeToken({ user_id: 14, family_ids: [], display_name: 'Yana' }), expires_in: 900 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  );

  renderApp();

  await screen.findByText('Все още нямаш списъци');
  await userEvent.click(screen.getByRole('button', { name: 'New list' }));
  await userEvent.type(screen.getByLabelText('List name'), 'Search overlay test');
  await userEvent.click(screen.getAllByRole('button', { name: 'Създай списък' })[0]);
  await userEvent.click(await screen.findByRole('button', { name: /Search overlay test/i }));

  await userEvent.click(screen.getByRole('button', { name: 'Search' }));

  expect(await screen.findByLabelText('Търси термин')).toBeInTheDocument();
  expect(screen.getByLabelText('Item term')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Затвори' }));

  expect(screen.queryByLabelText('Търси термин')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Item term')).toBeInTheDocument();
});

test('adding an item through the 🔍 Add/Search overlay shows it in the list immediately, with no reload', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 15, family_ids: [], display_name: 'Iva' }),
    expiresIn: 900,
    user: { id: 15, displayName: 'Iva', familyIds: [] }
  });

  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });

  mockFetch.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ auth: { access_token: makeToken({ user_id: 15, family_ids: [], display_name: 'Iva' }), expires_in: 900 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  );

  renderApp();

  await screen.findByText('Все още нямаш списъци');
  await userEvent.click(screen.getByRole('button', { name: 'New list' }));
  await userEvent.type(screen.getByLabelText('List name'), 'Overlay add test');
  await userEvent.click(screen.getAllByRole('button', { name: 'Създай списък' })[0]);
  await userEvent.click(await screen.findByRole('button', { name: /Overlay add test/i }));

  await userEvent.click(screen.getByRole('button', { name: 'Search' }));

  const searchInput = await screen.findByLabelText('Търси термин');
  await userEvent.type(searchInput, 'нов продукт абв');

  const addNewBtn = await screen.findByTestId('add-new-term');
  await userEvent.click(addNewBtn);

  await waitFor(() => expect(screen.queryByLabelText('Търси термин')).not.toBeInTheDocument());

  expect(await screen.findByText('нов продукт абв')).toBeInTheDocument();
});

test('boot offline (GET /lists rejects) still renders local-first data without an error', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 12, family_ids: [], display_name: 'Stoyan' }),
    expiresIn: 900,
    user: { id: 12, displayName: 'Stoyan', familyIds: [] }
  });

  await putList({
    client_uuid: 'offline-list-uuid-1',
    name: 'Cached locally',
    owner_type: 'user',
    owner_id: 12,
    updated_at: '2026-06-17T12:00:00.000Z'
  });

  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
  mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

  renderApp();

  expect(await screen.findByRole('button', { name: /Cached locally/i })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('deleting a list asks for confirmation, removes it immediately, and it survives a reload', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 15, family_ids: [], display_name: 'Mira' }),
    expiresIn: 900,
    user: { id: 15, displayName: 'Mira', familyIds: [] }
  });

  await putList({
    client_uuid: 'delete-list-uuid-1',
    id: '950',
    name: 'To delete',
    owner_type: 'user',
    owner_id: 15,
    updated_at: '2026-06-18T00:00:00.000Z'
  });

  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  mockFetch.mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.endsWith('/lists/950')) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });

  const view = renderApp();

  expect(await screen.findByText('To delete')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Изтрий To delete' }));

  expect(confirmSpy).toHaveBeenCalled();
  await waitFor(() => {
    expect(screen.queryByText('To delete')).not.toBeInTheDocument();
  });

  view.unmount();
  renderApp();

  expect(await screen.findByText('Все още нямаш списъци')).toBeInTheDocument();
  expect(screen.queryByText('To delete')).not.toBeInTheDocument();

  confirmSpy.mockRestore();
});

test('deleting a list while offline removes it immediately and it stays deleted once back online', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 16, family_ids: [], display_name: 'Plamen' }),
    expiresIn: 900,
    user: { id: 16, displayName: 'Plamen', familyIds: [] }
  });

  await putList({
    client_uuid: 'delete-list-uuid-2',
    id: '951',
    name: 'Offline delete',
    owner_type: 'user',
    owner_id: 16,
    updated_at: '2026-06-18T00:00:00.000Z'
  });

  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

  renderApp();

  expect(await screen.findByText('Offline delete')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Изтрий Offline delete' }));

  await waitFor(() => {
    expect(screen.queryByText('Offline delete')).not.toBeInTheDocument();
  });

  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  mockFetch.mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.endsWith('/lists/951')) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });
  window.dispatchEvent(new Event('online'));

  await waitFor(() => {
    expect(mockFetch.mock.calls.some(([input]) => (typeof input === 'string' ? input : (input as Request).url).endsWith('/lists/951'))).toBe(true);
  });

  confirmSpy.mockRestore();
});

test('renaming a list from the app bar saves immediately and persists after reload', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 17, family_ids: [], display_name: 'Iva' }),
    expiresIn: 900,
    user: { id: 17, displayName: 'Iva', familyIds: [] }
  });

  await putList({
    client_uuid: 'rename-list-uuid-1',
    id: '960',
    name: 'Original name',
    owner_type: 'user',
    owner_id: 17,
    updated_at: '2026-06-18T00:00:00.000Z'
  });

  mockFetch.mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.endsWith('/lists/960')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ list: { id: '960', name: 'Renamed', client_uuid: 'rename-list-uuid-1', owner_type: 'user', owner_id: '17', item_count: 0, updated_at: '2026-06-18T00:01:00.000Z' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });

  const view = renderApp();

  await userEvent.click(await screen.findByRole('button', { name: 'Отвори Original name' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Rename list' }));

  const input = screen.getByLabelText('List name');
  await userEvent.clear(input);
  await userEvent.type(input, 'Renamed{Enter}');

  expect(await screen.findByText('Renamed')).toBeInTheDocument();
  await waitFor(() => {
    expect(mockFetch.mock.calls.some(([input]) => (typeof input === 'string' ? input : (input as Request).url).endsWith('/lists/960'))).toBe(true);
  });

  view.unmount();
  renderApp();

  await userEvent.click(await screen.findByRole('button', { name: 'Отвори Renamed' }));
  expect(await screen.findByText('Renamed')).toBeInTheDocument();
});

test('renaming a list while offline updates the title immediately and keeps it after reconnect', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 18, family_ids: [], display_name: 'Boris' }),
    expiresIn: 900,
    user: { id: 18, displayName: 'Boris', familyIds: [] }
  });

  await putList({
    client_uuid: 'rename-list-uuid-2',
    id: '961',
    name: 'Offline original',
    owner_type: 'user',
    owner_id: 18,
    updated_at: '2026-06-18T00:00:00.000Z'
  });

  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
  mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

  renderApp();

  await userEvent.click(await screen.findByRole('button', { name: 'Отвори Offline original' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Rename list' }));

  const input = screen.getByLabelText('List name');
  await userEvent.clear(input);
  await userEvent.type(input, 'Offline renamed{Enter}');

  expect(await screen.findByText('Offline renamed')).toBeInTheDocument();

  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  mockFetch.mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.endsWith('/lists/961')) {
      return Promise.resolve(new Response(JSON.stringify({ list: { id: '961', name: 'Offline renamed', client_uuid: 'rename-list-uuid-2', owner_type: 'user', owner_id: '18', item_count: 0, updated_at: '2026-06-18T00:02:00.000Z' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });
  window.dispatchEvent(new Event('online'));

  await waitFor(() => {
    expect(mockFetch.mock.calls.some(([input]) => (typeof input === 'string' ? input : (input as Request).url).endsWith('/lists/961'))).toBe(true);
  });

  expect(screen.getByText('Offline renamed')).toBeInTheDocument();
});

test('saving a blank list name does not wipe out the existing name', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 19, family_ids: [], display_name: 'Nadia' }),
    expiresIn: 900,
    user: { id: 19, displayName: 'Nadia', familyIds: [] }
  });

  await putList({
    client_uuid: 'rename-list-uuid-3',
    id: '962',
    name: 'Keep me',
    owner_type: 'user',
    owner_id: 19,
    updated_at: '2026-06-18T00:00:00.000Z'
  });

  mockFetch.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  );

  renderApp();

  await userEvent.click(await screen.findByRole('button', { name: 'Отвори Keep me' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Rename list' }));

  const input = screen.getByLabelText('List name');
  await userEvent.clear(input);
  await userEvent.type(input, '   {Enter}');

  expect(await screen.findByText('Keep me')).toBeInTheDocument();
  expect(
    mockFetch.mock.calls.some(([input, init]) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      return url.endsWith('/lists/962') && init?.method === 'PATCH';
    })
  ).toBe(false);
});

test('renaming a list from the Lists overview (without opening it) saves and does not navigate into the list', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 20, family_ids: [], display_name: 'Petar' }),
    expiresIn: 900,
    user: { id: 20, displayName: 'Petar', familyIds: [] }
  });

  await putList({
    client_uuid: 'rename-list-uuid-4',
    id: '963',
    name: 'Overview original',
    owner_type: 'user',
    owner_id: 20,
    updated_at: '2026-06-18T00:00:00.000Z'
  });

  mockFetch.mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.endsWith('/lists/963')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ list: { id: '963', name: 'Overview renamed', client_uuid: 'rename-list-uuid-4', owner_type: 'user', owner_id: '20', item_count: 0, updated_at: '2026-06-18T00:01:00.000Z' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });

  renderApp();

  await screen.findByText('Overview original');
  await userEvent.click(await screen.findByRole('button', { name: 'Преименувай Overview original' }));

  const input = screen.getByLabelText('List name');
  await userEvent.clear(input);
  await userEvent.type(input, 'Overview renamed{Enter}');

  expect(await screen.findByText('Overview renamed')).toBeInTheDocument();
  await waitFor(() => {
    expect(mockFetch.mock.calls.some(([input]) => (typeof input === 'string' ? input : (input as Request).url).endsWith('/lists/963'))).toBe(true);
  });

  // Still on the overview, not navigated into the list (item count is still visible).
  expect(screen.getByText('0 items')).toBeInTheDocument();
});

// The card uses a full-bleed absolutely-positioned button under the visible content
// (with pointer-events: none on the static title/meta text) so a tap anywhere except
// the edit/delete icons opens the list. jsdom's userEvent.click() doesn't emulate real
// browser click-through for pointer-events: none, so this only exercises the button
// directly — the click-through behavior itself was verified with a real Chromium
// instance via Playwright before shipping (see commit history).
test('tapping anywhere on a Lists overview card opens the list', async () => {
  useAuthStore.getState().setSession({
    accessToken: makeToken({ user_id: 21, family_ids: [], display_name: 'Iliyana' }),
    expiresIn: 900,
    user: { id: 21, displayName: 'Iliyana', familyIds: [] }
  });

  await putList({
    client_uuid: 'open-list-uuid-1',
    id: '964',
    name: 'Open me',
    owner_type: 'user',
    owner_id: 21,
    updated_at: '2026-06-18T00:00:00.000Z'
  });

  mockFetch.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  );

  renderApp();

  await screen.findByText('Open me');
  await userEvent.click(screen.getByRole('button', { name: 'Отвори Open me' }));

  expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument();
});
