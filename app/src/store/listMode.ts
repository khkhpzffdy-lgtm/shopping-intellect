import { create } from 'zustand';

export type ListMode = 'planning' | 'shopping';

const STORAGE_KEY = 'si-list-modes';

const readModes = (): Record<string, ListMode> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ListMode>) : {};
  } catch {
    return {};
  }
};

type ListModeState = {
  modes: Record<string, ListMode>;
  setMode: (listKey: string, mode: ListMode) => void;
};

export const useListModeStore = create<ListModeState>((set) => ({
  modes: readModes(),
  setMode: (listKey, mode) =>
    set((state) => {
      const modes = { ...state.modes, [listKey]: mode };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(modes));
      return { modes };
    })
}));
