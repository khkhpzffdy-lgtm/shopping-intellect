import { useAuthStore } from '../store/auth';
import type { AuthEnvelope, SessionEnvelope, SessionUser } from '../types/auth';

let refreshTimeoutId: number | undefined;
let refreshPromise: Promise<AuthEnvelope> | null = null;

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return atob(padded);
};

const decodeTokenUser = (token: string): SessionUser | null => {
  try {
    const [, payload] = token.split('.');
    if (!payload) {
      return null;
    }

    const claims = JSON.parse(decodeBase64Url(payload)) as {
      user_id?: number | string;
      family_ids?: Array<number | string>;
      display_name?: string;
    };

    if (!claims.user_id) {
      return null;
    }

    return {
      id: Number(claims.user_id),
      displayName: claims.display_name ?? 'Member',
      familyIds: (claims.family_ids ?? []).map((familyId) => Number(familyId))
    };
  } catch {
    return null;
  }
};

export const applyAuthEnvelope = (
  envelope: AuthEnvelope,
  userOverride?: SessionUser | null
) => {
  const fallbackUser =
    userOverride !== undefined
      ? userOverride
      : useAuthStore.getState().user ?? decodeTokenUser(envelope.auth.access_token);

  useAuthStore.getState().setSession({
    accessToken: envelope.auth.access_token,
    expiresIn: envelope.auth.expires_in,
    user: fallbackUser
  });
};

export const clearScheduledRefresh = () => {
  if (refreshTimeoutId !== undefined) {
    window.clearTimeout(refreshTimeoutId);
    refreshTimeoutId = undefined;
  }
};

export const scheduleSilentRefresh = (expiresAt: number | null) => {
  clearScheduledRefresh();

  if (!expiresAt) {
    return;
  }

  const delay = Math.max(0, expiresAt - Date.now() - 60_000);
  refreshTimeoutId = window.setTimeout(() => {
    void refreshSession().catch(() => {
      useAuthStore.getState().clearSession();
    });
  }, delay);
};

export const normalizeSessionUser = (response: SessionEnvelope): SessionUser => ({
  id: response.user.id,
  displayName: response.user.display_name,
  familyIds: response.user.family_ids
});

export const refreshSession = async (): Promise<AuthEnvelope> => {
  if (!refreshPromise) {
    refreshPromise = fetchAuth<AuthEnvelope>('/auth/refresh', { method: 'POST' });
  }

  try {
    const envelope = await refreshPromise;
    applyAuthEnvelope(envelope);
    scheduleSilentRefresh(useAuthStore.getState().expiresAt);
    return envelope;
  } finally {
    refreshPromise = null;
  }
};

export const googleRedirectUri = () => 'https://shopping.flux.bg/';

export const googleAuthUrl = (): string | null => {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  if (!clientId) {
    return null;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account'
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

type FetchAuthInit = RequestInit & {
  body?: string;
};

const buildUrl = (path: string) => {
  const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  return `${apiBaseUrl}${path}`;
};

const parseError = async (response: Response) => {
  try {
    const payload = (await response.json()) as {
      code?: string;
      message?: string;
      details?: Record<string, string>;
      error?: {
        code?: string;
        message?: string;
        details?: Record<string, string>;
      };
    };

    return payload.error ?? payload;
  } catch {
    return { message: response.statusText };
  }
};

export class ApiError extends Error {
  code?: string;
  details?: Record<string, string>;
  status: number;

  constructor(status: number, message: string, code?: string, details?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const fetchAuth = async <T>(path: string, init: FetchAuthInit): Promise<T> => {
  const response = await fetch(buildUrl(path), {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const error = await parseError(response);
    throw new ApiError(response.status, error.message ?? 'Request failed', error.code, error.details);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};
