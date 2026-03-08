import type {
    IDagError,
    IDagRun,
    IStoragePort,
    ITaskRun,
    TResult
} from '@robota-sdk/dag-core';
import { buildValidationError } from '@robota-sdk/dag-core';

/** Composite query result containing a DAG run and its associated task runs. */
export interface IRunQueryResult {
    dagRun: IDagRun;
    taskRuns: ITaskRun[];
}

/**
 * Read-only query service for retrieving DAG run state and associated task runs.
 *
 * @see IStoragePort for persistence contracts
 */
export class RunQueryService {
    public constructor(private readonly storage: IStoragePort) {}

    /**
     * Retrieves a DAG run with all its task runs.
     * @param dagRunId - The unique identifier of the DAG run.
     * @returns The DAG run and its task runs, or a validation error if not found.
     */
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
