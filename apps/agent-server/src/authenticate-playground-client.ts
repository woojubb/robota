import jwt from 'jsonwebtoken';

/**
 * SEC-008 — who the caller is, decided by the TOKEN.
 *
 * This lived inline in `websocket-server.ts` and carried two defects that are one root: the token
 * was not the thing that decided the identity.
 *
 * - A "development fallback" accepted any three-dot-separated string, so `"a.b.c"` authenticated as
 *   any user. It was selected by `JWT_SECRET` being ABSENT — which is the state a misconfigured
 *   deployment is in, not a state only a developer can reach. A server that cannot verify a token
 *   has not verified it.
 * - The verified path discarded `jwt.verify`'s return and read `userId`/`sessionId` from the message
 *   body, so a holder of ANY valid token could claim another user's session and reach that session's
 *   broadcasts. A token that does not name who it is for cannot authorize anyone.
 *
 * It is a pure function so the decision can be tested without a socket, and so the transport layer
 * cannot reach past it.
 */
export type TPlaygroundAuthDecision =
  | { authenticated: true; userId: string; sessionId: string }
  | { authenticated: false; reason: string; configurationError?: string };

export interface IPlaygroundAuthAttempt {
  readonly userId: string;
  readonly sessionId: string;
  readonly token: string;
  /** The verification secret. `undefined` means the server cannot verify anything. */
  readonly secret: string | undefined;
}

export function authenticatePlaygroundClient(
  attempt: IPlaygroundAuthAttempt,
): TPlaygroundAuthDecision {
  const { userId, sessionId, token, secret } = attempt;

  if (!secret) {
    return {
      authenticated: false,
      reason: 'Server is not configured for authentication',
      configurationError:
        'JWT_SECRET is not set, so no authentication can be performed. Refusing the connection.',
    };
  }

  let claims: jwt.JwtPayload;
  try {
    const verified = jwt.verify(token, secret);
    // A token whose payload is a bare string carries no claims to bind an identity to.
    if (typeof verified === 'string') {
      return { authenticated: false, reason: 'Invalid or expired authentication token' };
    }
    claims = verified;
  } catch {
    return { authenticated: false, reason: 'Invalid or expired authentication token' };
  }

  const subject = typeof claims.sub === 'string' ? claims.sub : undefined;
  if (!subject) {
    return { authenticated: false, reason: 'Authentication token does not identify a user' };
  }
  if (subject !== userId) {
    return {
      authenticated: false,
      reason: 'Authentication token does not match the claimed user',
    };
  }

  // A token MAY scope itself to one session. When it does, the claim wins; when it does not, the
  // requested session stands — widening that is a separate decision, recorded in SEC-008 rather
  // than made here.
  const scopedSession = typeof claims.sessionId === 'string' ? claims.sessionId : undefined;
  if (scopedSession !== undefined && scopedSession !== sessionId) {
    return {
      authenticated: false,
      reason: 'Authentication token does not match the claimed session',
    };
  }

  return { authenticated: true, userId: subject, sessionId };
}
