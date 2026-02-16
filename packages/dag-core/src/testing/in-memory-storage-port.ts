import type {
    IDagDefinition,
    IDagRun,
    ITaskRun,
    TDagRunStatus,
    TTaskRunStatus
} from '../types/domain.js';
import type { IDagError } from '../types/error.js';
import type { IStoragePort } from '../interfaces/ports.js';

function buildTaskRunKey(dagRunId: string, taskRunId: string): string {
    return `${dagRunId}:${taskRunId}`;
}

export class InMemoryStoragePort implements IStoragePort {
    private readonly definitions = new Map<string, IDagDefinition>();
    private readonly latestPublishedVersionByDagId = new Map<string, number>();
    private readonly dagRuns = new Map<string, IDagRun>();
    private readonly taskRuns = new Map<string, ITaskRun>();

    public async saveDefinition(definition: IDagDefinition): Promise<void> {
        const definitionKey = `${definition.dagId}:${definition.version}`;
        this.definitions.set(definitionKey, definition);

        if (definition.status === 'published') {
            const currentLatestVersion = this.latestPublishedVersionByDagId.get(definition.dagId) ?? 0;
            if (definition.version > currentLatestVersion) {
                this.latestPublishedVersionByDagId.set(definition.dagId, definition.version);
            }
        }
    }

    public async getDefinition(dagId: string, version: number): Promise<IDagDefinition | undefined> {
        const definitionKey = `${dagId}:${version}`;
        return this.definitions.get(definitionKey);
    }

    public async listDefinitions(): Promise<IDagDefinition[]> {
        return [...this.definitions.values()]
            .sort((a, b) => a.dagId.localeCompare(b.dagId) || a.version - b.version);
    }

    public async listDefinitionsByDagId(dagId: string): Promise<IDagDefinition[]> {
        return [...this.definitions.values()]
            .filter((definition) => definition.dagId === dagId)
            .sort((a, b) => a.version - b.version);
    }

    public async getLatestPublishedDefinition(dagId: string): Promise<IDagDefinition | undefined> {
        const latestVersion = this.latestPublishedVersionByDagId.get(dagId);
        if (!latestVersion) {
            return undefined;
        }

        return this.definitions.get(`${dagId}:${latestVersion}`);
    }

    public async createDagRun(dagRun: IDagRun): Promise<void> {
        this.dagRuns.set(dagRun.dagRunId, dagRun);
    }

    public async getDagRun(dagRunId: string): Promise<IDagRun | undefined> {
        return this.dagRuns.get(dagRunId);
    }

    public async getDagRunByRunKey(runKey: string): Promise<IDagRun | undefined> {
        for (const dagRun of this.dagRuns.values()) {
            if (dagRun.runKey === runKey) {
                return dagRun;
            }
        }

        return undefined;
    }

    public async updateDagRunStatus(dagRunId: string, status: TDagRunStatus, endedAt?: string): Promise<void> {
        const current = this.dagRuns.get(dagRunId);
        if (!current) {
            return;
        }

        const next: IDagRun = {
            ...current,
            status,
            endedAt
        };

        this.dagRuns.set(dagRunId, next);
    }

    public async createTaskRun(taskRun: ITaskRun): Promise<void> {
        const taskRunKey = buildTaskRunKey(taskRun.dagRunId, taskRun.taskRunId);
        this.taskRuns.set(taskRunKey, taskRun);
    }

    public async getTaskRun(taskRunId: string): Promise<ITaskRun | undefined> {
        for (const taskRun of this.taskRuns.values()) {
            if (taskRun.taskRunId === taskRunId) {
                return taskRun;
            }
        }
        return undefined;
    }

    public async listTaskRunsByDagRunId(dagRunId: string): Promise<ITaskRun[]> {
        const results: ITaskRun[] = [];

        for (const taskRun of this.taskRuns.values()) {
            if (taskRun.dagRunId === dagRunId) {
                results.push(taskRun);
            }
        }

        return results;
    }

    public async updateTaskRunStatus(taskRunId: string, status: TTaskRunStatus, error?: IDagError): Promise<void> {
        for (const [taskRunKey, taskRun] of this.taskRuns.entries()) {
            if (taskRun.taskRunId !== taskRunId) {
                continue;
            }

            const next: ITaskRun = {
                ...taskRun,
                status,
                errorCode: error?.code,
                errorMessage: error?.message
            };

            this.taskRuns.set(taskRunKey, next);
            return;
        }
    }

    public async saveTaskRunSnapshots(
        taskRunId: string,
        inputSnapshot?: string,
        outputSnapshot?: string
    ): Promise<void> {
        for (const [taskRunKey, taskRun] of this.taskRuns.entries()) {
            if (taskRun.taskRunId !== taskRunId) {
                continue;
            }

            const next: ITaskRun = {
                ...taskRun,
                inputSnapshot: typeof inputSnapshot === 'string' ? inputSnapshot : taskRun.inputSnapshot,
                outputSnapshot: typeof outputSnapshot === 'string' ? outputSnapshot : taskRun.outputSnapshot
            };

            this.taskRuns.set(taskRunKey, next);
            return;
        }
    }

    public async incrementTaskAttempt(taskRunId: string): Promise<void> {
        for (const [taskRunKey, taskRun] of this.taskRuns.entries()) {
            if (taskRun.taskRunId !== taskRunId) {
                continue;
            }

            const next: ITaskRun = {
                ...taskRun,
                attempt: taskRun.attempt + 1
            };

            this.taskRuns.set(taskRunKey, next);
            return;
        }
    }
}
