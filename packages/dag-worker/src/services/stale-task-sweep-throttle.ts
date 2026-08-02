import { sweepStaleTaskRuns } from './stale-task-sweeper.js';

import type {
  IClockPort,
  IDagError,
  ILeasePort,
  IQueuePort,
  IStoragePort,
} from '@robota-sdk/dag-core';

/**
 * Runs the stale-task sweep at most once per lease duration.
 *
 * A lease cannot expire faster than `leaseDurationMs`, so sweeping more often than that can only
 * re-read storage to find the same nothing. Unthrottled it would run on every idle tick — which, with
 * the driver's 25ms idle floor, is a storage query forty times a second per worker.
 *
 * Owns its own clock state so the worker loop does not carry a field whose only reader is this rule.
 */
export class StaleTaskSweepThrottle {
  /** Zero means "never swept", so the first idle tick sweeps. */
  private lastSweepAtMs = 0;

  /** Guards against two overlapping sweeps on one throttle, now that the clock advances after. */
  private sweeping = false;

  public constructor(
    private readonly clock: IClockPort,
    private readonly lease: ILeasePort,
    private readonly options: { workerId: string; leaseDurationMs: number; maxAttempts: number },
  ) {}

  /**
   * Returns the sweep's failure rather than throwing it.
   *
   * A sweep runs on the IDLE branch of `processOnce`, whose promise the drivers only `.catch` when
   * stopping — so a throw here escaped into an unhandled rejection and killed the worker loop. Review
   * measured that path via the sqlite queue's PRIMARY KEY. Recovery failing must not take the worker
   * with it; the loop reports it, backs off, and tries again on the next idle tick.
   */
  public async sweepIfDue(
    storage: IStoragePort,
    queue: IQueuePort,
  ): Promise<IDagError | undefined> {
    const nowMs = this.clock.nowEpochMs();
    if (this.sweeping || nowMs - this.lastSweepAtMs < this.options.leaseDurationMs) {
      return undefined;
    }
    this.sweeping = true;
    try {
      const outcome = await sweepStaleTaskRuns(
        storage,
        queue,
        this.clock,
        this.lease,
        this.options,
      );
      const first = outcome.failed[0];
      if (first === undefined) {
        return undefined;
      }
      // A per-task failure is reported by the sweep rather than thrown, so it would otherwise be
      // swallowed here. Silence is not success: surface the first one as the loop's error.
      throw first.error;
    } catch (error) {
      return {
        code: 'DAG_TASK_SWEEP_FAILED',
        category: 'task_execution',
        message: `Stale-task sweep failed: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
        context: { workerId: this.options.workerId },
      };
    } finally {
      // Advanced AFTER the sweep, not before: a throwing sweep would otherwise suppress every retry
      // for a full lease duration, turning one failure into a window with no recovery at all.
      this.lastSweepAtMs = this.clock.nowEpochMs();
      this.sweeping = false;
    }
  }
}
