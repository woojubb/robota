export type TExecutionClaimKind = 'prompt' | 'fork-skill' | 'foreground-command';

export interface IExecutionClaim {
  readonly id: symbol;
  readonly kind: TExecutionClaimKind;
}

/** Identity-bound owner for the interactive foreground execution lifecycle. */
export class InteractiveExecutionClaimOwner {
  private activeClaim: IExecutionClaim | undefined;

  constructor(private readonly whileHeldCleanup: ReadonlyArray<() => void>) {}

  get active(): boolean {
    return this.activeClaim !== undefined;
  }

  acquire(kind: TExecutionClaimKind): IExecutionClaim {
    if (this.activeClaim !== undefined) {
      throw new Error('Another prompt or command is already running. Wait for it to finish.');
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
