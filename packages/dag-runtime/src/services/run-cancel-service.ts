import {
    DagRunStateMachine,
    buildValidationError,
    type IClockPort,
    type IDagError,
    type IStoragePort,
    type TResult
} from '@robota-sdk/dag-core';

/** Result returned after a DAG run has been successfully cancelled. */
export interface IRunCancelResult {
    dagRunId: string;
    status: 'cancelled';
}

/**
 * Service for cancelling active DAG runs via the state machine.
 *
 * @see DagRunStateMachine for valid cancellation transitions
 */
export class RunCancelService {
    public constructor(
        private readonly storage: IStoragePort,
        private readonly clock: IClockPort
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
                error: buildValidationError(
                    'DAG_VALIDATION_DAG_RUN_NOT_FOUND',
                    'DagRun was not found',
                    { dagRunId }
                )
            };
        }

        const transition = DagRunStateMachine.transition(dagRun.status, 'CANCEL');
        if (!transition.ok) {
            return transition;
        }

        await this.storage.updateDagRunStatus(
            dagRunId,
            transition.value.nextStatus,
            this.clock.nowIso()
        );

        return {
            ok: true,
            value: {
                dagRunId,
                status: 'cancelled'
            }
        };
    }
}
