import { ApiError, fetchAuth, refreshSession } from './session';
import { useAuthStore } from '../store/auth';
import type {
  AuthEnvelope,
  CredentialsPayload,
  GooglePayload,
  RegisterPayload,
  SessionEnvelope
} from '../types/auth';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  authenticated?: boolean;
  retryOnExpired?: boolean;
};

const buildHeaders = (authenticated: boolean) => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = useAuthStore.getState().accessToken;

  if (authenticated && token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return headers;
};

export const apiRequest = async <T>(
  path: string,
  { method = 'GET', body, authenticated = false, retryOnExpired = true }: RequestOptions = {}
): Promise<T> => {
  try {
    return await fetchAuth<T>(path, {
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: buildHeaders(authenticated)
    });
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      error.code === 'token_expired' &&
      authenticated &&
      retryOnExpired
    ) {
      try {
        await refreshSession();
      } catch {
        useAuthStore.getState().clearSession();
        throw error;
      }

      return apiRequest<T>(path, {
        method,
        body,
        authenticated,
        retryOnExpired: false
      });
    }

    if (
      error instanceof ApiError &&
      error.status === 401 &&
      (error.code === 'token_invalid' || error.code === 'token_reuse_detected')
    ) {
      useAuthStore.getState().clearSession();
    }

    throw error;
  }
};

export const login = (payload: CredentialsPayload) =>
  apiRequest<SessionEnvelope>('/auth/login', { method: 'POST', body: payload });

export const register = (payload: RegisterPayload) =>
  apiRequest<SessionEnvelope>('/auth/register', { method: 'POST', body: payload });

export const loginWithGoogle = (payload: GooglePayload) =>
  apiRequest<SessionEnvelope>('/auth/google', { method: 'POST', body: payload });

export const logout = () =>
  apiRequest<void>('/auth/logout', { method: 'POST', authenticated: true });

export const fetchProtected = <T>(path: string, options?: Omit<RequestOptions, 'authenticated'>) =>
  apiRequest<T>(path, { ...options, authenticated: true });

export type { AuthEnvelope, SessionEnvelope };
