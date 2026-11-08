/** A self-paced loop's durable lifecycle, independent of its disposable wake timer. */
export type TSessionLoopPhase = 'waiting' | 'pending' | 'running' | 'stopped' | 'expired';

/** Session-owned state needed to resume without replaying an uncertain iteration. */
export interface ISessionLoopState {
  loopId: string;
  instruction: string;
  /** Omitted prompts are re-resolved by the host before each iteration. */
  useDefaultPrompt?: boolean;
  createdAt: string;
  expiresAt: string;
  /** Monotonic change counter, used to reconcile an ambiguous store write. */
  revision: number;
  /** Incremented whenever a new opportunity to run is committed. */
  generation: number;
  phase: TSessionLoopPhase;
  /** Required while waiting; absent once that opportunity has been consumed. */
  nextAllowedAt?: string;
  /** Last committed choice, in the 1 minute–1 hour self-paced range. */
  delaySeconds?: number;
  reason?: string;
  /** Once consumed, an omitted decision cannot produce another fallback. */
  fallbackUsed: boolean;
  terminalReason?: string;
}

/**
 * What asking the session to stop its waiting self-paced loop did. `several` names how to choose one
 * instead of stopping any; `failed` carries the reason a chosen loop was not stopped.
 */
export type TWaitingLoopStopOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'several'; readonly message: string }
  | { readonly kind: 'stopped'; readonly loopId: string; readonly message?: string }
  | { readonly kind: 'failed'; readonly loopId?: string; readonly message: string };
