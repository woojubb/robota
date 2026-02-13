import * as fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import type { TUniversalValue } from '@robota-sdk/agents';

import type {
    IScenarioProviderStep,
    IScenarioRecord,
    IScenarioStep,
    IScenarioToolResultStep
} from './types.js';

export interface IScenarioStoreOptions {
    baseDir?: string;
}

// Single authoritative scenario format version.
const SCENARIO_FORMAT_VERSION = 1;

export class ScenarioStore {
    private readonly baseDir: string;
    private writeQueue: Promise<void> = Promise.resolve();
    private readonly writeLocks = new Map<string, { lockPath: string; fd: number }>();
    private exitHandlerRegistered = false;

    constructor(options?: IScenarioStoreOptions) {
        const envBaseDir = process.env.SCENARIO_BASE_DIR;
        const baseDir = options?.baseDir ?? envBaseDir;
        if (!baseDir) {
            throw new Error('[SCENARIO] Missing scenario baseDir. Provide ScenarioStore({ baseDir }) or set SCENARIO_BASE_DIR.');
        }
        this.baseDir = baseDir;
    }

    async loadForRecord(scenarioId: string): Promise<IScenarioRecord> {
        await this.ensureDirectory();
        const targetPath = this.getScenarioPath(scenarioId);

        try {
            const raw = await fs.readFile(targetPath, 'utf8');
            const parsed = JSON.parse(raw) as unknown;
            if (!isScenarioRecord(parsed)) {
                throw new Error(`[SCENARIO] Invalid scenario file format: ${targetPath}`);
            }
            if (parsed.scenarioId !== scenarioId) {
                throw new Error(
                    `[SCENARIO] ScenarioId mismatch for file: ${targetPath}. ` +
                    `Expected="${scenarioId}", Actual="${parsed.scenarioId}".`
                );
            }
            if (parsed.version !== SCENARIO_FORMAT_VERSION) {
                throw new Error(
                    `[SCENARIO] Invalid scenario file version: ${targetPath}. ` +
                    `Expected=${SCENARIO_FORMAT_VERSION}, Actual=${parsed.version}.`
                );
            }
            return parsed;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return {
                    scenarioId,
                    version: SCENARIO_FORMAT_VERSION,
                    steps: []
                };
            }
            throw error;
        }
    }

    async loadForPlay(scenarioId: string): Promise<IScenarioRecord> {
        await this.ensureDirectory();
        const targetPath = this.getScenarioPath(scenarioId);

        try {
            const raw = await fs.readFile(targetPath, 'utf8');
            const parsed = JSON.parse(raw) as unknown;
            if (!isScenarioRecord(parsed)) {
                throw new Error(`[SCENARIO] Invalid scenario file format: ${targetPath}`);
            }
            if (parsed.scenarioId !== scenarioId) {
                throw new Error(
                    `[SCENARIO] ScenarioId mismatch for file: ${targetPath}. ` +
                    `Expected="${scenarioId}", Actual="${parsed.scenarioId}".`
                );
            }
            if (parsed.version !== SCENARIO_FORMAT_VERSION) {
                throw new Error(
                    `[SCENARIO-PLAY] Invalid scenario file version: ${targetPath}. ` +
                    `Expected=${SCENARIO_FORMAT_VERSION}, Actual=${parsed.version}.`
                );
            }
            return parsed;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
                throw new Error(`[SCENARIO-PLAY] Scenario file not found: ${targetPath}`);
            }
            throw error;
        }
    }

    async listStepsForPlay(scenarioId: string): Promise<IScenarioStep[]> {
        const record = await this.loadForPlay(scenarioId);
        return [...record.steps];
    }

    async listProviderStepsForPlay(scenarioId: string): Promise<IScenarioProviderStep[]> {
        const steps = await this.listStepsForPlay(scenarioId);
        return steps.filter((step): step is IScenarioProviderStep => step.kind === 'provider');
    }

    async listToolResultStepsForPlay(scenarioId: string): Promise<IScenarioToolResultStep[]> {
        const steps = await this.listStepsForPlay(scenarioId);
        return steps.filter((step): step is IScenarioToolResultStep => step.kind === 'tool_result');
    }

    async appendStep(scenarioId: string, step: IScenarioStep): Promise<void> {
        this.writeQueue = this.writeQueue.then(async () => {
            await this.ensureWriteLock(scenarioId);
            const record = await this.loadForRecord(scenarioId);
            record.steps.push(step);
            await this.saveRecord(record);
        });
        return this.writeQueue;
    }

    async findProviderStepsByHashForPlay(scenarioId: string, requestHash: string): Promise<IScenarioProviderStep[]> {
        const steps = await this.listProviderStepsForPlay(scenarioId);
        return steps.filter(step => step.requestHash === requestHash);
    }

    async findProviderStepByHashForPlay(scenarioId: string, requestHash: string): Promise<IScenarioProviderStep | undefined> {
        const matches = await this.findProviderStepsByHashForPlay(scenarioId, requestHash);
        if (matches.length === 0) return undefined;
        if (matches.length > 1) {
            const sample = matches.slice(0, 3).map(step => step.stepId).join(', ');
            throw new Error(
                `[SCENARIO-AMBIGUOUS] Multiple steps match requestHash "${requestHash}" in scenario "${scenarioId}". ` +
                `Count=${matches.length}. Sample=${sample}. Use sequential strategy or fix the recording.`
            );
        }
        return matches[0];
    }

    async appendToolResultStep(params: {
        scenarioId: string;
        toolCallId: string;
        toolName: string;
        toolArguments: string;
        toolMessageContent: string;
        resultData?: TUniversalValue;
        success: boolean;
        errorMessage?: string;
        tags?: string[];
    }): Promise<void> {
        const step: IScenarioToolResultStep = {
            kind: 'tool_result',
            stepId: `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            toolCallId: params.toolCallId,
            toolName: params.toolName,
            toolArguments: params.toolArguments,
            toolMessageContent: params.toolMessageContent,
            ...(params.resultData !== undefined ? { resultData: params.resultData } : undefined),
            success: params.success,
            ...(params.errorMessage ? { errorMessage: params.errorMessage } : undefined),
            timestamp: Date.now(),
            tags: params.tags
        };
        await this.appendStep(params.scenarioId, step);
    }

    async assertNoUnusedToolResultsForPlay(scenarioId: string, usedToolCallIds: ReadonlySet<string>): Promise<void> {
        const toolSteps = await this.listToolResultStepsForPlay(scenarioId);
        const recordedToolCallIds = Array.from(new Set(toolSteps.map(step => step.toolCallId)));
        const unused = recordedToolCallIds.filter(id => !usedToolCallIds.has(id));
        if (unused.length > 0) {
            const sample = unused.slice(0, 3).join(', ');
            throw new Error(
                `[SCENARIO-UNUSED] ${unused.length} unused tool_result toolCallId(s) remain for scenario "${scenarioId}". ` +
                `Sample: ${sample}`
            );
        }
    }

    async findToolResultByToolCallIdForPlay(scenarioId: string, toolCallId: string): Promise<IScenarioToolResultStep> {
        const steps = await this.listToolResultStepsForPlay(scenarioId);
        const matches = steps.filter(step => step.toolCallId === toolCallId);

        if (matches.length === 0) {
            throw new Error(`[SCENARIO-TOOL] No tool_result step found for toolCallId="${toolCallId}".`);
        }
        if (matches.length > 1) {
            const distinctContents = Array.from(new Set(matches.map(m => m.toolMessageContent)));
            if (distinctContents.length === 1) {
                return matches[0];
            }
            const sample = matches.slice(0, 3).map(m => m.stepId).join(', ');
            throw new Error(
                `[SCENARIO-TOOL] Ambiguous toolCallId="${toolCallId}". ` +
                `Found ${matches.length} tool_result step(s) with ${distinctContents.length} distinct content values. Sample=${sample}.`
            );
        }

        return matches[0];
    }

    async findToolMessageContentByToolCallIdForPlay(scenarioId: string, toolCallId: string): Promise<string> {
        const step = await this.findToolResultByToolCallIdForPlay(scenarioId, toolCallId);
        return step.toolMessageContent;
    }

    private getScenarioPath(scenarioId: string): string {
        return path.join(this.baseDir, `${scenarioId}.json`);
    }

    private getLockDir(): string {
        return path.join(this.baseDir, '.locks');
    }

    private getLockPath(scenarioId: string): string {
        return path.join(this.getLockDir(), `${scenarioId}.lock`);
    }

    private registerExitHandler(): void {
        if (this.exitHandlerRegistered) {
            return;
        }
        this.exitHandlerRegistered = true;

        process.once('exit', () => {
            for (const { lockPath, fd } of this.writeLocks.values()) {
                try {
                    fsSync.closeSync(fd);
                } catch {
                    // ignore
                }
                try {
                    fsSync.unlinkSync(lockPath);
                } catch {
                    // ignore
                }
            }
        });
    }

    private async ensureWriteLock(scenarioId: string): Promise<void> {
        if (this.writeLocks.has(scenarioId)) {
            return;
        }

        await this.ensureDirectory();
        await fs.mkdir(this.getLockDir(), { recursive: true });

        const lockPath = this.getLockPath(scenarioId);

        try {
            const handle = await fs.open(lockPath, 'wx');
            const info = {
                scenarioId,
                pid: process.pid,
                createdAt: Date.now(),
                cwd: process.cwd()
            };
            await handle.writeFile(`${JSON.stringify(info)}\n`, 'utf8');
            await handle.close();

            const keepHandle = await fs.open(lockPath, 'r');
            this.writeLocks.set(scenarioId, { lockPath, fd: keepHandle.fd });
            this.registerExitHandler();
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'EEXIST') {
                throw new Error(
                    `[SCENARIO-LOCK] Scenario "${scenarioId}" is already locked for recording. ` +
                    `Refusing to append to prevent corrupt ordering. ` +
                    `If this is a stale lock, remove: ${lockPath}`
                );
            }
            throw error;
        }
    }

    private async ensureDirectory(): Promise<void> {
        await fs.mkdir(this.baseDir, { recursive: true });
    }

    private async saveRecord(record: IScenarioRecord): Promise<void> {
        const targetPath = this.getScenarioPath(record.scenarioId);
        await fs.writeFile(targetPath, JSON.stringify(record, null, 2), 'utf8');
    }
}

function isScenarioRecord(value: unknown): value is IScenarioRecord {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    if (typeof v['scenarioId'] !== 'string') return false;
    if (typeof v['version'] !== 'number') return false;
    if (!Array.isArray(v['steps'])) return false;
    return true;
}
