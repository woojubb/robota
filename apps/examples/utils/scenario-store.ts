import crypto from 'crypto';
import * as fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import type { IChatOptions, IRawProviderResponse, TUniversalMessage, TUniversalMessageMetadata } from '@robota-sdk/agents';
import { isAssistantMessage, isToolMessage, isUserMessage } from '@robota-sdk/agents';

export interface IScenarioStoreOptions {
    baseDir?: string;
}

export interface IScenarioToolCallSnapshot {
    id?: string;
    name?: string;
    arguments?: string;
}

export interface IScenarioMessageSnapshot {
    role: TUniversalMessage['role'];
    content: TUniversalMessage['content'];
    name?: string;
    toolCallId?: string;
    toolCalls?: ScenarioToolCallSnapshot[];
    metadata?: TUniversalMessageMetadata;
    timestamp: number;
}

export interface IScenarioResponseSnapshot {
    /** Non-stream response payload */
    message?: ScenarioMessageSnapshot;
    /** Raw provider response, if recording generateResponse */
    raw?: IRawProviderResponse;
    /** Streamed chunks captured during chatStream */
    stream?: Array<{
        index: number;
        delta: ScenarioMessageSnapshot;
        timestamp: number;
    }>;
}

export interface IScenarioRequestSnapshot {
    messages: ScenarioMessageSnapshot[];
    options?: ScenarioChatOptionsSnapshot;
    metadata?: Record<string, unknown>;
}

export interface IScenarioChatOptionsSnapshot {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    toolChoice?: string;
    stream?: boolean;
    tools?: Array<{ name?: string }>;
}

export interface IScenarioStep {
    stepId: string;
    requestHash: string;
    request: ScenarioRequestSnapshot;
    response: ScenarioResponseSnapshot;
    timestamp: number;
    tags?: string[];
    providerInfo?: {
        name: string;
        version: string;
    };
}

export interface IScenarioRecord {
    scenarioId: string;
    version: number;
    steps: ScenarioStep[];
}

const DEFAULT_VERSION = 1;

export class ScenarioStore {
    private readonly baseDir: string;
    private writeQueue: Promise<void> = Promise.resolve();
    private readonly writeLocks = new Map<string, { lockPath: string; fd: number }>();
    private exitHandlerRegistered = false;

    constructor(options?: ScenarioStoreOptions) {
        const envBaseDir = process.env.SCENARIO_BASE_DIR;
        this.baseDir = options?.baseDir ?? envBaseDir ?? path.resolve(process.cwd(), 'scenarios');
    }

    async load(scenarioId: string): Promise<ScenarioRecord> {
        await this.ensureDirectory();
        const targetPath = this.getScenarioPath(scenarioId);

        try {
            const raw = await fs.readFile(targetPath, 'utf8');
            const parsed = JSON.parse(raw) as ScenarioRecord;
            if (!parsed.steps) {
                parsed.steps = [];
            }
            return parsed;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return {
                    scenarioId,
                    version: DEFAULT_VERSION,
                    steps: []
                };
            }
            throw error;
        }
    }

    async listSteps(scenarioId: string): Promise<ScenarioStep[]> {
        const record = await this.load(scenarioId);
        return [...record.steps];
    }

    async appendStep(scenarioId: string, step: ScenarioStep): Promise<void> {
        this.writeQueue = this.writeQueue.then(async () => {
            await this.ensureWriteLock(scenarioId);
            const record = await this.load(scenarioId);
            record.steps.push(step);
            await this.saveRecord(record);
        });
        return this.writeQueue;
    }

    async findStepByHash(scenarioId: string, requestHash: string): Promise<ScenarioStep | undefined> {
        const steps = await this.listSteps(scenarioId);
        return steps.find(step => step.requestHash === requestHash);
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

        // Best-effort cleanup for graceful exits. This is not a fallback path:
        // - lock acquisition is still strict (fail-fast on contention).
        // - stale locks from crashes must be removed manually by the developer.
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
            const fd = handle.fd;
            const info = {
                scenarioId,
                pid: process.pid,
                createdAt: Date.now(),
                cwd: process.cwd()
            };
            await handle.writeFile(`${JSON.stringify(info)}\n`, 'utf8');
            await handle.close();

            // Re-open in read-only mode to keep an OS-level handle associated with the lock file.
            // This makes the "locked by this process" state explicit in memory and simplifies cleanup on exit.
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

    private async saveRecord(record: ScenarioRecord): Promise<void> {
        const targetPath = this.getScenarioPath(record.scenarioId);
        await fs.writeFile(targetPath, JSON.stringify(record, null, 2), 'utf8');
    }
}

/**
 * Create deterministic hash for scenario lookup
 */
export function createRequestHash(messages: TUniversalMessage[], options?: IChatOptions): string {
    const payload = stableStringify({
        messages: serializeMessagesForHash(messages),
        options: serializeOptionsForHash(options)
    });
    return crypto.createHash('md5').update(payload).digest('hex');
}
export function serializeMessages(messages: TUniversalMessage[]): ScenarioMessageSnapshot[] {
    return messages.map(message => serializeMessage(message));
}

export function serializeChatOptions(options?: IChatOptions): ScenarioChatOptionsSnapshot | undefined {
    if (!options) {
        return undefined;
    }
    const snapshot: ScenarioChatOptionsSnapshot = {};
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

export function deserializeMessage(snapshot: ScenarioMessageSnapshot): TUniversalMessage {
    const timestamp = new Date(snapshot.timestamp);
    const metadata = snapshot.metadata ? structuredClone(snapshot.metadata) : undefined;

    switch (snapshot.role) {
        case 'user': {
            if (typeof snapshot.content !== 'string') {
                throw new Error('[SCENARIO] Invalid user message content (expected string)');
            }
            return {
                role: 'user',
                content: snapshot.content,
                ...(snapshot.name && { name: snapshot.name }),
                ...(metadata && { metadata }),
                timestamp
            };
        }
        case 'system': {
            if (typeof snapshot.content !== 'string') {
                throw new Error('[SCENARIO] Invalid system message content (expected string)');
            }
            return {
                role: 'system',
                content: snapshot.content,
                ...(metadata && { metadata }),
                timestamp
            };
        }
        case 'tool': {
            if (typeof snapshot.content !== 'string') {
                throw new Error('[SCENARIO] Invalid tool message content (expected string)');
            }
            if (!snapshot.toolCallId) {
                throw new Error('[SCENARIO] Missing toolCallId for tool message');
            }
            if (!snapshot.name) {
                throw new Error('[SCENARIO] Missing name for tool message');
            }
            return {
                role: 'tool',
                content: snapshot.content,
                toolCallId: snapshot.toolCallId,
                name: snapshot.name,
                ...(metadata && { metadata }),
                timestamp
            };
        }
        case 'assistant': {
            return {
                role: 'assistant',
                content: snapshot.content ?? null,
                ...(snapshot.toolCalls && {
                    toolCalls: snapshot.toolCalls.map(tc => ({
                        id: tc.id ?? '',
                        type: 'function' as const,
                        function: {
                            name: tc.name ?? '',
                            arguments: tc.arguments ?? ''
                        }
                    }))
                }),
                ...(metadata && { metadata }),
                timestamp
            };
        }
    }
}

export function hydrateResponseSnapshot(snapshot: ScenarioResponseSnapshot): {
    message?: TUniversalMessage;
    raw?: IRawProviderResponse;
    stream?: Array<{ index: number; delta: TUniversalMessage; timestamp: number }>;
} {
    return {
        raw: snapshot.raw ? structuredClone(snapshot.raw) : undefined,
        message: snapshot.message ? deserializeMessage(snapshot.message) : undefined,
        stream: snapshot.stream?.map(chunk => ({
            index: chunk.index,
            timestamp: chunk.timestamp,
            delta: deserializeMessage(chunk.delta)
        }))
    };
}

export function serializeResponseSnapshot(response: {
    message?: TUniversalMessage;
    raw?: IRawProviderResponse;
    stream?: Array<{ index: number; delta: TUniversalMessage; timestamp: number }>;
}): ScenarioResponseSnapshot {
    return {
        message: response.message ? serializeMessage(response.message) : undefined,
        raw: response.raw ? structuredClone(response.raw) : undefined,
        stream: response.stream?.map(chunk => ({
            index: chunk.index,
            delta: serializeMessage(chunk.delta),
            timestamp: chunk.timestamp
        }))
    };
}

function serializeMessage(message: TUniversalMessage): ScenarioMessageSnapshot {
    const base: ScenarioMessageSnapshot = {
        role: message.role,
        content: message.content ?? null,
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

function serializeTimestamp(timestamp: Date): number {
    return timestamp.getTime();
}

function serializeMessagesForHash(messages: TUniversalMessage[]): unknown {
    return messages.map(message => ({
        role: message.role,
        content: message.content ?? null,
        ...(isUserMessage(message) && message.name ? { name: message.name } : undefined),
        ...(isToolMessage(message) ? { toolCallId: message.toolCallId, name: message.name } : undefined),
        ...(isAssistantMessage(message) && message.toolCalls
            ? {
                toolCalls: message.toolCalls.map(tc => ({
                    name: tc.function?.name,
                    arguments: tc.function?.arguments
                }))
            }
            : undefined)
    }));
}

function serializeOptionsForHash(options?: IChatOptions): unknown {
    if (!options) {
        return undefined;
    }
    return {
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        topP: (options as Record<string, number>).topP,
        presencePenalty: (options as Record<string, number>).presencePenalty,
        frequencyPenalty: (options as Record<string, number>).frequencyPenalty,
        stream: options.openai?.stream,
        tools: options.tools?.map(tool => ({
            name: (tool as { name?: string }).name
        }))
    };
}

function stableStringify(value: unknown): string {
    if (value === null || value === undefined) {
        return 'null';
    }

    if (typeof value !== 'object') {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map(item => stableStringify(item)).join(',')}]`;
    }

    const entries = Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b));

    const serialized = entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',');
    return `{${serialized}}`;
}

