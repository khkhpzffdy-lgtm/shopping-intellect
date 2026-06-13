export type SessionUser = {
  id: number;
  displayName: string;
  familyIds: number[];
};

export type AuthEnvelope = {
  auth: {
    access_token: string;
    expires_in: number;
  };
};

export type SessionEnvelope = AuthEnvelope & {
  user: {
    id: number;
    display_name: string;
    family_ids: number[];
  };
};

export type ApiErrorEnvelope = {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
};

export type CredentialsPayload = {
  email: string;
  password: string;
};

export type RegisterPayload = CredentialsPayload & {
  display_name: string;
};
