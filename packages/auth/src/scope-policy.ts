import type {
  IAuthError,
  IAuthPrincipal,
  IRequiredScopesPolicy,
  IScopeDecision,
  TAuthResult,
} from './types.js';

export function createAuthError(
  code: IAuthError['code'],
  message: string,
  retryable = false,
): IAuthError {
  return { code, message, retryable };
}

export function hasScope(principal: IAuthPrincipal, requiredScope: string): boolean {
  return principal.scopes.includes(requiredScope);
}

export function evaluateScopes(
  principal: IAuthPrincipal,
  policy: IRequiredScopesPolicy,
): IScopeDecision {
  if (policy.requiredScopes.length === 0) {
    return { allowed: true, missingScopes: [] };
  }

  const missingScopes = policy.requiredScopes.filter((scope) => !hasScope(principal, scope));
  const mode = policy.mode ?? 'all';
  if (mode === 'any') {
    return {
      allowed: missingScopes.length < policy.requiredScopes.length,
      missingScopes,
    };
  }

  return {
    allowed: missingScopes.length === 0,
    missingScopes,
  };
}

export function requireScopes(
  principal: IAuthPrincipal,
  policy: IRequiredScopesPolicy,
): TAuthResult<IScopeDecision> {
  const decision = evaluateScopes(principal, policy);
  if (decision.allowed) {
    return { ok: true, value: decision };
  }
  return {
    ok: false,
    error: createAuthError(
      'AUTH_SCOPE_DENIED',
      `Principal ${principal.principalId} does not satisfy required scopes`,
    ),
  };
}
