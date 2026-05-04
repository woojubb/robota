import { describe, expect, it } from 'vitest';
import type { IAuthPrincipal } from '../types.js';
import { evaluateScopes, requireScopes } from '../scope-policy.js';

function createPrincipal(scopes: readonly string[]): IAuthPrincipal {
  return {
    principalId: 'principal-1',
    kind: 'service',
    subject: 'svc:test',
    scopes,
  };
}

describe('auth scope policy', () => {
  it('allows a principal with every required scope by default', () => {
    const decision = evaluateScopes(createPrincipal(['workflow:run', 'asset:read']), {
      requiredScopes: ['workflow:run'],
    });

    expect(decision).toEqual({ allowed: true, missingScopes: [] });
  });

  it('denies a principal missing a required scope in all mode', () => {
    const result = requireScopes(createPrincipal(['asset:read']), {
      requiredScopes: ['workflow:run', 'asset:read'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AUTH_SCOPE_DENIED');
    }
  });

  it('allows a principal with at least one required scope in any mode', () => {
    const decision = evaluateScopes(createPrincipal(['asset:read']), {
      requiredScopes: ['workflow:run', 'asset:read'],
      mode: 'any',
    });

    expect(decision.allowed).toBe(true);
    expect(decision.missingScopes).toEqual(['workflow:run']);
  });
});
