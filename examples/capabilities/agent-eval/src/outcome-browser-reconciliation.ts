export interface IBrowserReconciliationObservation {
  interrupted: boolean;
  resumedInterrupted: boolean;
  cancellationPropagated: boolean;
  restoredOutcome: boolean;
  sameSessionId: boolean;
  before?: { theme: string; writes: number };
  after: { theme: string; writes: number };
  resumedCalls: readonly string[];
}

/** Score immutable owner observations; a plausible final answer cannot satisfy these gates. */
export function assertBrowserReconciled(observation: IBrowserReconciliationObservation): void {
  if (
    !observation.interrupted ||
    observation.resumedInterrupted ||
    !observation.cancellationPropagated ||
    !observation.restoredOutcome ||
    !observation.sameSessionId ||
    observation.before?.theme !== 'dark' ||
    observation.before.writes !== 1 ||
    observation.after.theme !== 'dark' ||
    observation.after.writes !== 1 ||
    observation.resumedCalls.length !== 1 ||
    observation.resumedCalls[0] !== 'browser_snapshot'
  ) {
    throw new Error(
      `Browser reconciliation failed: interrupted effect must be observed without replay; ${JSON.stringify(observation)}`,
    );
  }
}
