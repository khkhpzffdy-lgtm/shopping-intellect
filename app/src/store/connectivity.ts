import { create } from 'zustand';

type ConnectivityState = {
  isOnline: boolean;
  setOnline: (isOnline: boolean) => void;
};

export const useConnectivityStore = create<ConnectivityState>((set) => ({
  isOnline: navigator.onLine,
  setOnline: (isOnline) => set({ isOnline })
}));

window.addEventListener('online', () => useConnectivityStore.getState().setOnline(true));
window.addEventListener('offline', () => useConnectivityStore.getState().setOnline(false));
