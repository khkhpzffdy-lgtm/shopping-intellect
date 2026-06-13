import { beforeEach, describe, expect, test } from 'vitest';
import { useThemeStore } from '../store/theme';

const STORAGE_KEY = 'si-theme';

const readStoredTheme = (): 'light' | 'dark' => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'dark';
};

describe('theme store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('defaults to dark with empty localStorage', () => {
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  test('setTheme updates state and localStorage', () => {
    useThemeStore.getState().setTheme('light');

    expect(useThemeStore.getState().theme).toBe('light');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  test('reading localStorage after setTheme reflects the persisted theme', () => {
    useThemeStore.getState().setTheme('light');

    expect(readStoredTheme()).toBe('light');
  });
});
