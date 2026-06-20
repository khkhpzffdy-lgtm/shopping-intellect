import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startUpdateCheck } from '../updateCheck';

const ORIGINAL_LOCATION = window.location;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...ORIGINAL_LOCATION, reload: vi.fn() }
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: ORIGINAL_LOCATION
  });
});

const withScriptTag = (src: string) => {
  document.documentElement.innerHTML = `<head><script type="module" src="${src}"></script></head><body></body>`;
};

test('reloads when the server starts serving a different content-hashed bundle', async () => {
  withScriptTag('/assets/index-OLD123.js');

  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('<script type="module" src="/assets/index-NEW456.js"></script>', { status: 200 })
  );

  startUpdateCheck();

  await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

  expect(window.location.reload).toHaveBeenCalledTimes(1);
});

test('does not reload when the server still serves the same bundle', async () => {
  withScriptTag('/assets/index-SAME789.js');

  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('<script type="module" src="/assets/index-SAME789.js"></script>', { status: 200 })
  );

  startUpdateCheck();

  await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

  expect(window.location.reload).not.toHaveBeenCalled();
});

test('does not reload when the update check request fails', async () => {
  withScriptTag('/assets/index-OLD123.js');

  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

  startUpdateCheck();

  await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

  expect(window.location.reload).not.toHaveBeenCalled();
});
