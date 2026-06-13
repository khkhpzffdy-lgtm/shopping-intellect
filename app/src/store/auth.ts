import { create } from 'zustand';
import type { SessionUser } from '../types/auth';

type SessionInput = {
  accessToken: string;
  expiresIn: number;
  user: SessionUser | null;
};

type AuthState = {
  accessToken: string | null;
  expiresAt: number | null;
  user: SessionUser | null;
  setSession: (session: SessionInput) => void;
  clearSession: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  expiresAt: null,
  user: null,
  setSession: ({ accessToken, expiresIn, user }) =>
    set({
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
      user
    }),
  clearSession: () =>
    set({
      accessToken: null,
      expiresAt: null,
      user: null
    })
}));
