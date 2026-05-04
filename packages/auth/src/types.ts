export type TAuthCredentialKind = 'api-key' | 'bearer-token' | 'session-token';

export type TAuthPrincipalKind = 'user' | 'service' | 'anonymous';

export type TAuthScopeMode = 'all' | 'any';

export type TAuthMetadataValue =
  | string
  | number
  | boolean
  | null
  | IAuthMetadata
  | TAuthMetadataValue[];

export interface IAuthMetadata {
  [key: string]: TAuthMetadataValue | undefined;
}

export interface IAuthCredential {
  kind: TAuthCredentialKind;
  value: string;
  issuer?: string;
}

export interface IAuthPrincipal {
  principalId: string;
  kind: TAuthPrincipalKind;
  subject: string;
  scopes: readonly string[];
  metadata?: IAuthMetadata;
}

export interface IAuthContext {
  principal: IAuthPrincipal;
  credentialKind: TAuthCredentialKind;
  authenticatedAt: string;
  expiresAt?: string;
}

export type TAuthErrorCode =
  | 'AUTH_CREDENTIAL_MISSING'
  | 'AUTH_CREDENTIAL_INVALID'
  | 'AUTH_CREDENTIAL_EXPIRED'
  | 'AUTH_SCOPE_DENIED'
  | 'AUTH_VERIFIER_UNAVAILABLE';

export interface IAuthError {
  code: TAuthErrorCode;
  message: string;
  retryable: boolean;
  metadata?: IAuthMetadata;
}

export type TAuthResult<TValue> = { ok: true; value: TValue } | { ok: false; error: IAuthError };

export interface IAuthVerifierPort {
  verifyCredential(credential: IAuthCredential): Promise<TAuthResult<IAuthContext>>;
}

export interface IRequiredScopesPolicy {
  requiredScopes: readonly string[];
  mode?: TAuthScopeMode;
}

export interface IScopeDecision {
  allowed: boolean;
  missingScopes: readonly string[];
}
