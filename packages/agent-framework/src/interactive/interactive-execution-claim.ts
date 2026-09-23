export type TExecutionClaimKind = 'prompt' | 'fork-skill' | 'foreground-command' | 'runtime-tool';

export interface IExecutionClaim {
  readonly id: symbol;
  readonly kind: TExecutionClaimKind;
}

/** Identity-bound owner for the interactive foreground execution lifecycle. */
export class InteractiveExecutionClaimOwner {
  private pendingSubmissions = 0;
  private activeClaim: IExecutionClaim | undefined;

  constructor(private readonly whileHeldCleanup: ReadonlyArray<() => void>) {}

  get active(): boolean {
    return this.activeClaim !== undefined;
  }

  beginSubmission(): void {
    if (this.activeClaim?.kind === 'runtime-tool') {
      throw new Error('A runtime tool is already running. Wait for it to finish.');
    }
    this.pendingSubmissions += 1;
  }

  endSubmission(): void {
    this.pendingSubmissions -= 1;
  }

  acquire(kind: TExecutionClaimKind): IExecutionClaim {
    if (this.activeClaim !== undefined) {
      throw new Error('Another prompt or command is already running. Wait for it to finish.');
    }
    if (kind === 'runtime-tool' && this.pendingSubmissions > 0) {
      throw new Error('A submission is already being admitted. Wait for it to finish.');
    }
    const claim = { id: Symbol(kind), kind };
    this.activeClaim = claim;
    return claim;
  }

  complete(claim: IExecutionClaim, afterRelease: () => void): void {
    if (this.activeClaim !== claim) return;

    let cleanupError: unknown;
    for (const step of this.whileHeldCleanup) {
      try {
        step();
      } catch (error) {
        cleanupError ??= error;
      }
    }

    // Release and handoff are adjacent synchronous operations, so a public submission cannot
    // acquire ahead of the already queued head.
    this.activeClaim = undefined;
    afterRelease();
    if (cleanupError !== undefined) throw cleanupError;
  }
}
