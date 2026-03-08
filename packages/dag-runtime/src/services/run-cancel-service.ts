import {
    DagRunStateMachine,
    buildValidationError,
    type IClockPort,
    type IDagError,
    type IStoragePort,
    type TResult
} from '@robota-sdk/dag-core';

export interface IRunCancelResult {
    dagRunId: string;
    status: 'cancelled';
}

export class RunCancelService {
    public constructor(
        private readonly storage: IStoragePort,
        private readonly clock: IClockPort
    ) {}

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
