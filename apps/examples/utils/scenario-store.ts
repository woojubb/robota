import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { UniversalMessage, ChatOptions, RawProviderResponse } from '@robota-sdk/agents';

export interface ScenarioStoreOptions {
    baseDir?: string;
}

export interface ScenarioToolCallSnapshot {
    id?: string;
    name?: string;
    arguments?: string;
}

export interface ScenarioMessageSnapshot {
    role: UniversalMessage['role'];
    content: UniversalMessage['content'];
    name?: string;
    toolCallId?: string;
    toolCalls?: ScenarioToolCallSnapshot[];
    metadata?: Record<string, unknown>;
    timestamp?: number;
}

export interface ScenarioResponseSnapshot {
    /** Non-stream response payload */
    message?: ScenarioMessageSnapshot;
    /** Raw provider response, if recording generateResponse */
    raw?: RawProviderResponse;
    /** Streamed chunks captured during chatStream */
    stream?: Array<{
        index: number;
        delta: ScenarioMessageSnapshot;
        timestamp: number;
    }>;
}

export interface ScenarioRequestSnapshot {
    messages: ScenarioMessageSnapshot[];
    options?: ScenarioChatOptionsSnapshot;
    metadata?: Record<string, unknown>;
}

export interface ScenarioChatOptionsSnapshot {
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

export interface ScenarioStep {
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

export interface ScenarioRecord {
    scenarioId: string;
    version: number;
    steps: ScenarioStep[];
}

const DEFAULT_VERSION = 1;

export class ScenarioStore {
    private readonly baseDir: string;
    private writeQueue: Promise<void> = Promise.resolve();

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
export function createRequestHash(messages: UniversalMessage[], options?: ChatOptions): string {
    const payload = stableStringify({
        messages: serializeMessagesForHash(messages),
        options: serializeOptionsForHash(options)
    });
    return crypto.createHash('md5').update(payload).digest('hex');
}
export function serializeMessages(messages: UniversalMessage[]): ScenarioMessageSnapshot[] {
    return messages.map(message => serializeMessage(message));
}

export function serializeChatOptions(options?: ChatOptions): ScenarioChatOptionsSnapshot | undefined {
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
    if (typeof options.toolChoice === 'string') {
        snapshot.toolChoice = options.toolChoice;
    }
    if (typeof options.stream === 'boolean') {
        snapshot.stream = options.stream;
    }
    if (Array.isArray(options.tools)) {
        snapshot.tools = options.tools.map(tool => ({ name: (tool as { name?: string }).name }));
    }
    return snapshot;
}

export function deserializeMessage(snapshot: ScenarioMessageSnapshot): UniversalMessage {
    return {
        role: snapshot.role,
        content: snapshot.content ?? null,
        name: snapshot.name,
        toolCallId: snapshot.toolCallId,
        metadata: snapshot.metadata ? structuredClone(snapshot.metadata) : undefined,
        toolCalls: snapshot.toolCalls?.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
                name: tc.name ?? '',
                arguments: tc.arguments ?? ''
            }
        })),
        timestamp: typeof snapshot.timestamp === 'number' ? new Date(snapshot.timestamp) : undefined
    };
}

export function hydrateResponseSnapshot(snapshot: ScenarioResponseSnapshot): {
    message?: UniversalMessage;
    raw?: RawProviderResponse;
    stream?: Array<{ index: number; delta: UniversalMessage; timestamp: number }>;
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
    message?: UniversalMessage;
    raw?: RawProviderResponse;
    stream?: Array<{ index: number; delta: UniversalMessage; timestamp: number }>;
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

function serializeMessage(message: UniversalMessage): ScenarioMessageSnapshot {
    return {
        role: message.role,
        content: message.content ?? null,
        name: message.name,
        toolCallId: message.toolCallId,
        metadata: message.metadata ? structuredClone(message.metadata) : undefined,
        toolCalls: message.toolCalls?.map(tc => ({
            id: tc.id,
            name: tc.function?.name,
            arguments: tc.function?.arguments
        })),
        timestamp: serializeTimestamp(message.timestamp)
    };
}

function serializeTimestamp(timestamp?: Date): number | undefined {
    if (!timestamp) {
        return undefined;
    }
    if (timestamp instanceof Date) {
        return timestamp.getTime();
    }
    if (typeof (timestamp as unknown) === 'number') {
        return timestamp as unknown as number;
    }
    if (typeof (timestamp as unknown) === 'string') {
        const parsed = Date.parse(timestamp as unknown as string);
        return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
}

function serializeMessagesForHash(messages: UniversalMessage[]): unknown {
    return messages.map(message => ({
        role: message.role,
        content: message.content ?? null,
        name: message.name,
        toolCallId: message.toolCallId,
        toolCalls: message.toolCalls?.map(tc => ({
            name: tc.function?.name,
            arguments: tc.function?.arguments
        })),
        functionCall: (message as Record<string, unknown>).functionCall
            ? {
                name: (message as Record<string, { name?: string }>).functionCall?.name,
                arguments: (message as Record<string, { arguments?: string }>).functionCall?.arguments
            }
            : undefined
    }));
}

function serializeOptionsForHash(options?: ChatOptions): unknown {
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
        toolChoice: options.toolChoice,
        stream: options.stream,
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

