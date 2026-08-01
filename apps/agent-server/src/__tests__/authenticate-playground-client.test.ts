import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import { authenticatePlaygroundClient } from '../authenticate-playground-client.js';

/**
 * SEC-008. The decision is a pure function precisely so these cases can be stated without a socket
 * — the socket test in `websocket-server.test.ts` proves the transport HONOURS this decision; these
 * prove the decision itself.
 *
 * Both defects this replaces are asserted from the failing side first: an unverifiable token is not
 * a weaker credential, and a valid token that names someone else is not a credential for this user.
 */
describe('authenticatePlaygroundClient (SEC-008)', () => {
  const secret = 'test-secret';
  const sign = (payload: object) => jwt.sign(payload, secret);

  it('refuses everything when there is no secret — an unverifiable token is not a weaker one', () => {
    // The exact string the removed development fallback accepted.
    const decision = authenticatePlaygroundClient({
      userId: 'user-123',
      sessionId: 'session-1',
      token: 'a.b.c',
      secret: undefined,
    });
    expect(decision.authenticated).toBe(false);
    expect(decision).toMatchObject({ reason: 'Server is not configured for authentication' });
    // …and it says so where an operator will see it, rather than serving on quietly.
    expect(decision.authenticated === false && decision.configurationError).toContain('JWT_SECRET');
  });

  it('refuses a valid token that names a DIFFERENT user than the request claims', () => {
    const decision = authenticatePlaygroundClient({
      userId: 'user-BBB',
      sessionId: 'session-1',
      token: sign({ sub: 'user-AAA' }),
      secret,
    });
    expect(decision).toMatchObject({
      authenticated: false,
      reason: 'Authentication token does not match the claimed user',
    });
  });

  it('refuses a valid token that carries no subject to bind an identity to', () => {
    const decision = authenticatePlaygroundClient({
      userId: 'user-123',
      sessionId: 'session-1',
      token: sign({ someOtherClaim: 'user-123' }),
      secret,
    });
    expect(decision).toMatchObject({
      authenticated: false,
      reason: 'Authentication token does not identify a user',
    });
  });

  it('refuses a token scoped to a different session', () => {
    const decision = authenticatePlaygroundClient({
      userId: 'user-123',
      sessionId: 'session-WANTED',
      token: sign({ sub: 'user-123', sessionId: 'session-GRANTED' }),
      secret,
    });
    expect(decision).toMatchObject({
      authenticated: false,
      reason: 'Authentication token does not match the claimed session',
    });
  });

  it('refuses a token signed with a different secret', () => {
    const decision = authenticatePlaygroundClient({
      userId: 'user-123',
      sessionId: 'session-1',
      token: jwt.sign({ sub: 'user-123' }, 'some-other-secret'),
      secret,
    });
    expect(decision).toMatchObject({
      authenticated: false,
      reason: 'Invalid or expired authentication token',
    });
  });

  it('refuses an expired token', () => {
    const decision = authenticatePlaygroundClient({
      userId: 'user-123',
      sessionId: 'session-1',
      token: jwt.sign({ sub: 'user-123' }, secret, { expiresIn: '-1s' }),
      secret,
    });
    expect(decision).toMatchObject({
      authenticated: false,
      reason: 'Invalid or expired authentication token',
    });
  });

  it('accepts a token for the user it names, and returns the identity FROM the claim', () => {
    const decision = authenticatePlaygroundClient({
      userId: 'user-123',
      sessionId: 'session-1',
      token: sign({ sub: 'user-123' }),
      secret,
    });
    expect(decision).toEqual({ authenticated: true, userId: 'user-123', sessionId: 'session-1' });
  });

  it('accepts a token scoped to the session being requested', () => {
    const decision = authenticatePlaygroundClient({
      userId: 'user-123',
      sessionId: 'session-1',
      token: sign({ sub: 'user-123', sessionId: 'session-1' }),
      secret,
    });
    expect(decision).toEqual({ authenticated: true, userId: 'user-123', sessionId: 'session-1' });
  });
});
