/** Raised by `sessionParticipant`/`robotaParticipant` sessions; never by the roundtable core. */
export class RobotaParticipantError extends Error {
  constructor(
    public readonly code:
      | 'unsupported-wait'
      | 'identity-mismatch'
      | 'checkpoint-invalid'
      | 'journal-missing'
      | 'resource-reused',
    message: string,
  ) {
    super(message);
    this.name = 'RobotaParticipantError';
  }
}

/** Raised by `robotaSelector` while turning a model decision into a `Selection`. */
export class SelectorDecisionError extends Error {
  constructor(
    public readonly code:
      | 'no-candidates'
      | 'no-decision'
      | 'multiple-decisions'
      | 'invalid-decision'
      | 'unknown-participant',
    message: string,
  ) {
    super(message);
    this.name = 'SelectorDecisionError';
  }
}
