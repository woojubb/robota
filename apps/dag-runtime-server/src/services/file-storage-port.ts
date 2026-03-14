import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
    IDagDefinition,
    IDagRun,
    IDagError,
    IStoragePort,
    ITaskRun,
    TDagRunStatus,
    TTaskRunStatus
} from '@robota-sdk/dag-core';

function buildTaskRunKey(dagRunId: string, taskRunId: string): string {
    return `${dagRunId}:${taskRunId}`;
}

function encodeSegment(value: string): string {
    return encodeURIComponent(value);
}

function decodeSegment(value: string): string {
    return decodeURIComponent(value);
}

export class FileStoragePort implements IStoragePort {
    private readonly definitionsRootPath: string;
    private isInitialized = false;
    private readonly dagRuns = new Map<string, IDagRun>();
    private readonly taskRuns = new Map<string, ITaskRun>();

    public constructor(private readonly storageRootPath: string) {
        this.definitionsRootPath = path.join(this.storageRootPath, 'definitions');
    }

    private async ensureInitialized(): Promise<void> {
        if (this.isInitialized) {
            return;
        }
        await mkdir(this.definitionsRootPath, { recursive: true });
        this.isInitialized = true;
    }

    private resolveDefinitionDirectoryPath(dagId: string): string {
        return path.join(this.definitionsRootPath, encodeSegment(dagId));
    }

    private resolveDefinitionFilePath(dagId: string, version: number): string {
        return path.join(this.resolveDefinitionDirectoryPath(dagId), `${version}.json`);
    }

    private async saveDefinitionAtomically(definition: IDagDefinition): Promise<void> {
        const definitionDirectoryPath = this.resolveDefinitionDirectoryPath(definition.dagId);
        await mkdir(definitionDirectoryPath, { recursive: true });
        const definitionFilePath = this.resolveDefinitionFilePath(definition.dagId, definition.version);
        const temporaryFilePath = `${definitionFilePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const serializedDefinition = JSON.stringify(definition, null, 2);
        await writeFile(temporaryFilePath, serializedDefinition, 'utf-8');
        await rename(temporaryFilePath, definitionFilePath);
    }

    private async readDefinitionFromFile(filePath: string): Promise<IDagDefinition | undefined> {
        try {
            const content = await readFile(filePath, 'utf-8');
            return JSON.parse(content) as IDagDefinition;
        } catch {
            return undefined;
        }
    }

    public async saveDefinition(definition: IDagDefinition): Promise<void> {
        await this.ensureInitialized();
        await this.saveDefinitionAtomically(definition);
    }

    public async getDefinition(dagId: string, version: number): Promise<IDagDefinition | undefined> {
        await this.ensureInitialized();
        const definitionFilePath = this.resolveDefinitionFilePath(dagId, version);
        return this.readDefinitionFromFile(definitionFilePath);
    }

    public async listDefinitions(): Promise<IDagDefinition[]> {
        await this.ensureInitialized();
        const dagIdDirectories = await readdir(this.definitionsRootPath, { withFileTypes: true });
        const definitions: IDagDefinition[] = [];
        for (const dagIdDirectory of dagIdDirectories) {
            if (!dagIdDirectory.isDirectory()) {
                continue;
            }
            const decodedDagId = decodeSegment(dagIdDirectory.name);
            const definitionsForDagId = await this.listDefinitionsByDagId(decodedDagId);
            definitions.push(...definitionsForDagId);
        }
        return definitions.sort((a, b) => a.dagId.localeCompare(b.dagId) || a.version - b.version);
    }

    public async listDefinitionsByDagId(dagId: string): Promise<IDagDefinition[]> {
        await this.ensureInitialized();
        const definitionDirectoryPath = this.resolveDefinitionDirectoryPath(dagId);
        let entries;
        try {
            entries = await readdir(definitionDirectoryPath, { withFileTypes: true });
        } catch {
            return [];
        }
        const definitions: IDagDefinition[] = [];
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) {
                continue;
            }
            const rawVersion = entry.name.replace('.json', '').trim();
            if (!/^\d+$/.test(rawVersion)) {
                continue;
            }
            const definition = await this.readDefinitionFromFile(path.join(definitionDirectoryPath, entry.name));
            if (definition) {
                definitions.push(definition);
            }
        }
        return definitions.sort((a, b) => a.version - b.version);
    }

    public async getLatestPublishedDefinition(dagId: string): Promise<IDagDefinition | undefined> {
        const definitionsByDagId = await this.listDefinitionsByDagId(dagId);
        const publishedDefinitions = definitionsByDagId.filter((definition) => definition.status === 'published');
        if (publishedDefinitions.length === 0) {
            return undefined;
        }
        return publishedDefinitions[publishedDefinitions.length - 1];
    }

    public async createDagRun(dagRun: IDagRun): Promise<void> {
        this.dagRuns.set(dagRun.dagRunId, dagRun);
    }

    public async getDagRun(dagRunId: string): Promise<IDagRun | undefined> {
        return this.dagRuns.get(dagRunId);
    }

    public async listDagRuns(): Promise<IDagRun[]> {
        return [...this.dagRuns.values()].sort((a, b) => a.dagRunId.localeCompare(b.dagRunId));
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
        const currentDagRun = this.dagRuns.get(dagRunId);
        if (!currentDagRun) {
            return;
        }
        this.dagRuns.set(dagRunId, {
            ...currentDagRun,
            status,
            endedAt
        });
    }

    public async deleteDagRun(dagRunId: string): Promise<void> {
        this.dagRuns.delete(dagRunId);
    }

    public async createTaskRun(taskRun: ITaskRun): Promise<void> {
        this.taskRuns.set(buildTaskRunKey(taskRun.dagRunId, taskRun.taskRunId), taskRun);
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
        const taskRuns: ITaskRun[] = [];
        for (const taskRun of this.taskRuns.values()) {
            if (taskRun.dagRunId === dagRunId) {
                taskRuns.push(taskRun);
            }
        }
        return taskRuns;
    }

    public async deleteTaskRunsByDagRunId(dagRunId: string): Promise<void> {
        for (const [taskRunKey, taskRun] of this.taskRuns.entries()) {
            if (taskRun.dagRunId === dagRunId) {
                this.taskRuns.delete(taskRunKey);
            }
        }
    }

    public async updateTaskRunStatus(taskRunId: string, status: TTaskRunStatus, error?: IDagError): Promise<void> {
        for (const [taskRunKey, taskRun] of this.taskRuns.entries()) {
            if (taskRun.taskRunId !== taskRunId) {
                continue;
            }
            this.taskRuns.set(taskRunKey, {
                ...taskRun,
                status,
                errorCode: error?.code,
                errorMessage: error?.message
            });
            return;
        }
    }

    public async saveTaskRunSnapshots(
        taskRunId: string,
        inputSnapshot?: string,
        outputSnapshot?: string,
        estimatedCredits?: number,
        totalCredits?: number
    ): Promise<void> {
        for (const [taskRunKey, taskRun] of this.taskRuns.entries()) {
            if (taskRun.taskRunId !== taskRunId) {
                continue;
            }
            this.taskRuns.set(taskRunKey, {
                ...taskRun,
                inputSnapshot: typeof inputSnapshot === 'string' ? inputSnapshot : taskRun.inputSnapshot,
                outputSnapshot: typeof outputSnapshot === 'string' ? outputSnapshot : taskRun.outputSnapshot,
                estimatedCredits: typeof estimatedCredits === 'number' ? estimatedCredits : taskRun.estimatedCredits,
                totalCredits: typeof totalCredits === 'number' ? totalCredits : taskRun.totalCredits
            });
            return;
        }
    }

    public async incrementTaskAttempt(taskRunId: string): Promise<void> {
        for (const [taskRunKey, taskRun] of this.taskRuns.entries()) {
            if (taskRun.taskRunId !== taskRunId) {
                continue;
            }
            this.taskRuns.set(taskRunKey, {
                ...taskRun,
                attempt: taskRun.attempt + 1
            });
            return;
        }
    }

    public async deleteDefinition(dagId: string, version: number): Promise<void> {
        await this.ensureInitialized();
        const definitionFilePath = this.resolveDefinitionFilePath(dagId, version);
        await rm(definitionFilePath, { force: true });
        const definitionDirectoryPath = this.resolveDefinitionDirectoryPath(dagId);
        try {
            const entries = await readdir(definitionDirectoryPath);
            if (entries.length === 0) {
                await rm(definitionDirectoryPath, { recursive: true, force: true });
            }
        } catch {
            // Directory cleanup is best-effort only.
        }
    }
}
