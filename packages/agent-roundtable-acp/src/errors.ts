export type AcpParticipantErrorCode =
  | 'invalid-options'
  | 'startup-timeout'
  | 'handshake-failed'
  | 'protocol-version-mismatch'
  | 'session-released'
  | 'session-dead'
  | 'turn-in-progress'
  | 'connection-closed'
  | 'agent-error'
  | 'max-tokens'
  | 'max-turn-requests'
  | 'cancelled'
  | 'refusal'
  | 'unknown-stop-reason';

/** Raised by an ACP participant and its sessions; never by the roundtable core. */
export class AcpParticipantError extends Error {
  constructor(
    public readonly code: AcpParticipantErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AcpParticipantError';
  }
}
