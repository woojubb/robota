import {
  DagRunStateMachine,
  buildValidationError,
  type IClockPort,
  type IDagError,
  type IStoragePort,
  type TResult,
} from '@robota-sdk/dag-core';

/** Result returned after a DAG run has been successfully cancelled. */
export interface IRunCancelResult {
  dagRunId: string;
  status: 'cancelled';
}

/** Same-process notification after the cancellation wins persistence arbitration. */
export interface IRunCancellationNotifier {
  notifyRunCancelled(dagRunId: string): void;
}

/**
 * Service for cancelling active DAG runs via the state machine.
 *
 * @see DagRunStateMachine for valid cancellation transitions
 */
export class RunCancelService {
  public constructor(
    private readonly storage: IStoragePort,
    private readonly clock: IClockPort,
    private readonly notifier?: IRunCancellationNotifier,
  ) {}

  /**
   * Cancels a DAG run if its current status allows the CANCEL transition.
   * @param dagRunId - The unique identifier of the DAG run to cancel.
   * @returns The cancelled run ID and status, or an error if the transition is invalid.
   */
  public async cancelRun(dagRunId: string): Promise<TResult<IRunCancelResult, IDagError>> {
    const dagRun = await this.storage.getDagRun(dagRunId);
    if (!dagRun) {
      return {
        ok: false,
        error: buildValidationError('DAG_VALIDATION_DAG_RUN_NOT_FOUND', 'DagRun was not found', {
          dagRunId,
        }),
      };
    }

    const transition = DagRunStateMachine.transition(dagRun.status, 'CANCEL');
    if (!transition.ok) {
      return transition;
    }

    const committed = await this.storage.commitExecution(dagRunId, {
      kind: 'transition-run',
      expectedStatus: dagRun.status,
      event: 'CANCEL',
      endedAt: this.clock.nowIso(),
    });
    if (!committed.applied) {
      // Cancellation must arbitrate against the current state, never overwrite a terminal winner.
      if (committed.runStatus === 'cancelled') {
        this.notify(dagRunId);
        return { ok: true, value: { dagRunId, status: 'cancelled' } };
      }
      if (committed.runStatus !== undefined) {
        const current = DagRunStateMachine.transition(committed.runStatus, 'CANCEL');
        if (!current.ok) return current;
        // A nonterminal transition won; retry against that new state.
        return this.cancelRun(dagRunId);
      }
      return {
        ok: false,
        error: buildValidationError('DAG_VALIDATION_DAG_RUN_NOT_FOUND', 'DagRun was not found', {
          dagRunId,
        }),
      };
    }

    this.notify(dagRunId);
    return {
      ok: true,
      value: {
        dagRunId,
        status: 'cancelled',
      },
    };
  }

  private notify(dagRunId: string): void {
    // The durable cancellation already won; a local notification cannot undo it.
    try {
      this.notifier?.notifyRunCancelled(dagRunId);
    } catch {
      // Other processes still observe the persisted state on admission.
    }
  }
}
