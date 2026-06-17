import { beforeEach, expect, test, vi } from 'vitest';
import { fetchAuth } from '../api/session';
import { useConnectivityStore } from '../store/connectivity';

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://www.example.com/wp-json/si/v1');
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  useConnectivityStore.getState().setOnline(true);
});

test('a network-level throw flips the store to offline', async () => {
  mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

  await expect(fetchAuth('/auth/refresh', { method: 'POST' })).rejects.toThrow();

  expect(useConnectivityStore.getState().isOnline).toBe(false);
});

test('a subsequent non-2xx response flips the store back to online', async () => {
  useConnectivityStore.getState().setOnline(false);
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ code: 'token_invalid' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  );

  await expect(fetchAuth('/auth/refresh', { method: 'POST' })).rejects.toThrow();

  expect(useConnectivityStore.getState().isOnline).toBe(true);
});
