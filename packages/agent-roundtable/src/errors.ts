export class RoundtableError extends Error {
  constructor(
    public readonly code:
      | 'invalid-config'
      | 'invalid-selection'
      | 'invalid-context'
      | 'busy'
      | 'conflict'
      | 'disposed'
      | 'stale-claim'
      | 'recovery-required'
      | 'model-call-limit'
      | 'budget-limit'
      | 'call-settled',
    message: string,
  ) {
    super(message);
    this.name = 'RoundtableError';
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
