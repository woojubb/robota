import type {
    IDagError,
    IDagRun,
    IStoragePort,
    ITaskRun,
    TResult
} from '@robota-sdk/dag-core';
import { buildValidationError } from '@robota-sdk/dag-core';

export interface IRunQueryResult {
    dagRun: IDagRun;
    taskRuns: ITaskRun[];
}

export class RunQueryService {
    public constructor(private readonly storage: IStoragePort) {}

    public async getRun(dagRunId: string): Promise<TResult<IRunQueryResult, IDagError>> {
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

        const taskRuns = await this.storage.listTaskRunsByDagRunId(dagRunId);
        return {
            ok: true,
            value: {
                dagRun,
                taskRuns
            }
        };
    }
}
