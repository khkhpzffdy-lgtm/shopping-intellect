import { useAuthStore } from '../store/auth';
import type { AuthEnvelope, SessionEnvelope, SessionUser } from '../types/auth';

let refreshTimeoutId: number | undefined;
let refreshPromise: Promise<AuthEnvelope> | null = null;

const AUTH_HANDOFF_KEY = 'si_auth_handoff_v1';
const AUTH_BREADCRUMBS_KEY = 'si_auth_breadcrumbs_v1';
const AUTH_HANDOFF_TTL_MS = 10 * 60 * 1000;

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

export const noteAuthBreadcrumb = (event: string) => {
  try {
    const existing = sessionStorage.getItem(AUTH_BREADCRUMBS_KEY);
    const breadcrumbs = existing ? (JSON.parse(existing) as string[]) : [];
    const next = [...breadcrumbs.slice(-11), `${new Date().toISOString()} ${event}`];
    sessionStorage.setItem(AUTH_BREADCRUMBS_KEY, JSON.stringify(next));
  } catch {
    // Best-effort diagnostics only.
  }
};

export const saveAuthHandoff = (envelope: SessionEnvelope) => {
  try {
    localStorage.setItem(
      AUTH_HANDOFF_KEY,
      JSON.stringify({
        saved_at: Date.now(),
        envelope
      })
    );
    noteAuthBreadcrumb('saved auth handoff');
  } catch {
    // Best-effort recovery only.
  }
};

export const consumeAuthHandoff = (): SessionEnvelope | null => {
  try {
    const raw = localStorage.getItem(AUTH_HANDOFF_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as {
      saved_at?: number;
      envelope?: SessionEnvelope;
    };

    // Always remove it — it's single-use regardless of TTL.
    localStorage.removeItem(AUTH_HANDOFF_KEY);

    if (
      typeof parsed.saved_at !== 'number' ||
      !parsed.envelope ||
      Date.now() - parsed.saved_at > AUTH_HANDOFF_TTL_MS
    ) {
      return null;
    }

    noteAuthBreadcrumb('consumed auth handoff');
    return parsed.envelope;
  } catch {
    localStorage.removeItem(AUTH_HANDOFF_KEY);
    return null;
  }
};

export const clearAuthHandoff = () => {
  try {
    localStorage.removeItem(AUTH_HANDOFF_KEY);
  } catch {
    // Best-effort cleanup only.
  }
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
      // Silent failure — the next API call will get 401 and retry refresh.
      // Never clear the session here: a network hiccup or iOS background
      // suspension should not log the user out.
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
    noteAuthBreadcrumb('refresh started');
    refreshPromise = fetchAuth<AuthEnvelope>('/auth/refresh', { method: 'POST' });
  }

  try {
    const envelope = await refreshPromise;
    applyAuthEnvelope(envelope);
    scheduleSilentRefresh(useAuthStore.getState().expiresAt);
    clearAuthHandoff();
    noteAuthBreadcrumb('refresh succeeded');
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
