import { act, renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { useBackHandler } from '../hooks/useBackHandler';

// Dispatches a synthetic popstate directly rather than calling
// window.history.back() — jsdom's support for actually firing popstate on
// programmatic back() is inconsistent/version-dependent, whereas every real
// browser does this reliably. The hook's own listener only ever reacts to
// the popstate event itself, never to history position, so this exercises
// the same code path a real back-gesture would.
const fireBack = () => {
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
};

describe('useBackHandler', () => {
  test('a single active handler responds to one back gesture', () => {
    const onBack = vi.fn();
    const { unmount } = renderHook(() => useBackHandler(true, onBack));

    fireBack();

    expect(onBack).toHaveBeenCalledTimes(1);
    unmount();
  });

  test('an inactive handler never registers, never responds', () => {
    const onBack = vi.fn();
    const { unmount } = renderHook(() => useBackHandler(false, onBack));

    fireBack();

    expect(onBack).not.toHaveBeenCalled();
    unmount();
  });

  test('with two stacked active handlers, one gesture closes only the topmost, the next closes the one below it', () => {
    const outerOnBack = vi.fn();
    const innerOnBack = vi.fn();

    const outer = renderHook(() => useBackHandler(true, outerOnBack));
    const inner = renderHook(() => useBackHandler(true, innerOnBack));

    fireBack();

    expect(innerOnBack).toHaveBeenCalledTimes(1);
    expect(outerOnBack).not.toHaveBeenCalled();

    fireBack();

    expect(outerOnBack).toHaveBeenCalledTimes(1);

    inner.unmount();
    outer.unmount();
  });
});
