import crypto from 'crypto';
import * as fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import type { IChatOptions, TToolParameters, TUniversalMessage, TUniversalValue } from '@robota-sdk/agents';
import { isAssistantMessage, isToolMessage, isUserMessage } from '@robota-sdk/agents';

import type {
    IScenarioChatOptionsSnapshot,
    IScenarioMessageSnapshot,
    IScenarioProviderStep,
    IScenarioRecord,
    IScenarioRequestSnapshot,
    IScenarioStep,
    IScenarioToolResultStep
} from './types';

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
        return steps.filter(step => createRequestHashFromSnapshot(step.request) === requestHash);
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
            success: params.success,
            ...(params.errorMessage ? { errorMessage: params.errorMessage } : undefined),
            timestamp: Date.now(),
            tags: params.tags
        };
        await this.appendStep(params.scenarioId, step);
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

export function serializeMessages(messages: TUniversalMessage[]): IScenarioMessageSnapshot[] {
    return messages.map(message => serializeMessage(message));
}

export function serializeChatOptions(options?: IChatOptions): IScenarioChatOptionsSnapshot | undefined {
    if (!options) return undefined;
    const snapshot: IScenarioChatOptionsSnapshot = {};
    if (options.model) snapshot.model = options.model;
    if (typeof options.temperature === 'number') snapshot.temperature = options.temperature;
    if (typeof options.maxTokens === 'number') snapshot.maxTokens = options.maxTokens;
    if (typeof (options as Record<string, unknown>).topP === 'number') snapshot.topP = (options as Record<string, number>).topP;
    if (typeof (options as Record<string, unknown>).presencePenalty === 'number') {
        snapshot.presencePenalty = (options as Record<string, number>).presencePenalty;
    }
    if (typeof (options as Record<string, unknown>).frequencyPenalty === 'number') {
        snapshot.frequencyPenalty = (options as Record<string, number>).frequencyPenalty;
    }
    if (typeof options.openai?.stream === 'boolean') {
        snapshot.stream = options.openai.stream;
    }
    if (Array.isArray(options.tools)) {
        snapshot.tools = options.tools.map(tool => ({ name: (tool as { name?: string }).name }));
    }
    return snapshot;
}

export function createRequestHash(messages: TUniversalMessage[], options?: IChatOptions): string {
    const payload = stableStringify({
        messages: serializeMessagesForHash(messages),
        options: serializeOptionsForHash(options)
    });
    return crypto.createHash('md5').update(payload).digest('hex');
}

export function createRequestHashFromSnapshot(request: IScenarioRequestSnapshot): string {
    const payload = stableStringify({
        messages: request.messages.map(m => ({
            role: m.role,
            content: m.role === 'assistant' ? (typeof m.content === 'string' ? m.content : '') : (m.content ?? null),
            ...(m.role === 'user' && m.name ? { name: m.name } : undefined),
            ...(m.role === 'tool' ? { toolCallId: m.toolCallId } : undefined),
            ...(m.role === 'assistant' && Array.isArray(m.toolCalls)
                ? { toolCalls: m.toolCalls.map(tc => ({ id: tc.id, name: tc.name, arguments: tc.arguments })) }
                : undefined)
        })),
        options: request.options ? serializeOptionsForHash(request.options) : undefined
    });
    return crypto.createHash('md5').update(payload).digest('hex');
}

function serializeMessage(message: TUniversalMessage): IScenarioMessageSnapshot {
    const base: IScenarioMessageSnapshot = {
        role: message.role,
        content: message.role === 'assistant' ? (typeof message.content === 'string' ? message.content : '') : (message.content ?? null),
        metadata: message.metadata ? structuredClone(message.metadata) : undefined,
        timestamp: message.timestamp.getTime()
    };

    if (isUserMessage(message) && message.name) {
        base.name = message.name;
    }
    if (isToolMessage(message)) {
        base.toolCallId = message.toolCallId;
        base.name = message.name;
    }
    if (isAssistantMessage(message) && message.toolCalls) {
        base.toolCalls = message.toolCalls.map(tc => ({
            id: tc.id,
            name: tc.function?.name,
            arguments: tc.function?.arguments
        }));
    }

    return base;
}

function serializeMessagesForHash(messages: TUniversalMessage[]): TUniversalValue {
    return messages.map(message => ({
        role: message.role,
        content: message.role === 'assistant' ? (typeof message.content === 'string' ? message.content : '') : (message.content ?? null),
        ...(isUserMessage(message) && message.name ? { name: message.name } : undefined),
        ...(isToolMessage(message) ? { toolCallId: message.toolCallId } : undefined),
        ...(isAssistantMessage(message) && message.toolCalls
            ? {
                toolCalls: message.toolCalls.map(tc => ({
                    id: tc.id,
                    name: tc.function?.name,
                    arguments: tc.function?.arguments
                }))
            }
            : undefined)
    }));
}

function serializeOptionsForHash(options?: IChatOptions | IScenarioChatOptionsSnapshot): TUniversalValue | undefined {
    if (!options) return undefined;
    const snapshot: Record<string, TUniversalValue> = {};
    const opt = options as Partial<IScenarioChatOptionsSnapshot> & Partial<IChatOptions>;

    if (typeof opt.model === 'string') snapshot.model = opt.model;
    if (typeof opt.temperature === 'number') snapshot.temperature = opt.temperature;
    if (typeof opt.maxTokens === 'number') snapshot.maxTokens = opt.maxTokens;
    if (typeof opt.topP === 'number') snapshot.topP = opt.topP;
    if (typeof opt.presencePenalty === 'number') snapshot.presencePenalty = opt.presencePenalty;
    if (typeof opt.frequencyPenalty === 'number') snapshot.frequencyPenalty = opt.frequencyPenalty;
    if (typeof opt.stream === 'boolean') snapshot.stream = opt.stream;

    const openaiStream = opt.openai?.stream;
    if (typeof openaiStream === 'boolean') snapshot.stream = openaiStream;

    const tools = opt.tools;
    if (Array.isArray(tools)) snapshot.tools = tools.map(t => ({ name: t.name }));

    return snapshot;
}

function stableStringify(value: TUniversalValue | undefined): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`;
    const entries = Object.entries(value as Record<string, TUniversalValue>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function stringifyToolArguments(parameters: TToolParameters): string {
    // SSOT: tool arguments are stored as stable JSON string.
    return stableStringify(parameters);
}


