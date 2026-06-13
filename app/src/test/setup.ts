import '@testing-library/jest-dom/vitest';

const createStorage = () => {
  let data = new Map<string, string>();

  return {
    get length() {
      return data.size;
    },
    clear() {
      data = new Map<string, string>();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    }
  };
};

Object.defineProperty(window, 'localStorage', {
  value: createStorage(),
  configurable: true
});

Object.defineProperty(window, 'sessionStorage', {
  value: createStorage(),
  configurable: true
});
