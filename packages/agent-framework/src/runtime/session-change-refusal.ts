/**
 * #3189 — a session change the host declined, with a code the client can branch on.
 *
 * The SHAPE is a contract (`ISessionChangeRefusal` in `@robota-sdk/agent-interface-session`); the
 * class lives here, beside the code that throws it, because an interface package is inert by rule.
 */

import type {
  ISessionChangeRefusal,
  TSessionChangeRefusalCode,
} from '@robota-sdk/agent-interface-session';

export type { TSessionChangeRefusalCode };

export class SessionChangeRefusal extends Error implements ISessionChangeRefusal {
  override readonly name = 'SessionChangeRefusal' as const;
  constructor(
    readonly code: TSessionChangeRefusalCode,
    message: string,
  ) {
    super(message);
  }
}
