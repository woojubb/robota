import type { AIProvider, ChatOptions, RawProviderResponse, ProviderRequest } from '@robota-sdk/agents';
import type { UniversalMessage } from '@robota-sdk/agents';
import {
    ScenarioStore,
    createRequestHash,
    serializeMessages,
    serializeChatOptions,
    serializeResponseSnapshot,
    hydrateResponseSnapshot
} from '../utils/scenario-store';
import type { ScenarioStep } from '../utils/scenario-store';

type StreamChunkInput = { index: number; delta: UniversalMessage; timestamp: number };

type RecordingResponseInput = {
    message?: UniversalMessage;
    raw?: RawProviderResponse;
    stream?: StreamChunkInput[];
};

interface ScenarioMetadata {
    scenarioId: string;
    store: ScenarioStore;
    tags?: string[];
}

export interface ScenarioRecorderOptions extends ScenarioMetadata {
    metadata?: Record<string, unknown>;
}

export interface ScenarioMockProviderOptions extends ScenarioMetadata {
    strategy?: 'hash' | 'sequential';
    providerName?: string;
    providerVersion?: string;
}

/**
 * Create a provider wrapper that records every request/response pair.
 */
export function createScenarioRecordingProvider(delegate: AIProvider, options: ScenarioRecorderOptions): AIProvider {
    return new ScenarioRecordingProvider(delegate, options);
}

/**
 * Create a mock provider that replays previously recorded responses.
 */
export function createScenarioMockProvider(options: ScenarioMockProviderOptions): AIProvider {
    return new ScenarioMockAIProvider(options);
}

class ScenarioRecordingProvider implements AIProvider {
    readonly name: string;
    readonly version: string;

    constructor(
        private readonly delegate: AIProvider,
        private readonly options: ScenarioRecorderOptions
    ) {
        this.name = delegate.name;
        this.version = delegate.version;
    }

    async chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage> {
        const response = await this.delegate.chat(messages, options);
        await this.recordStep(messages, options, { message: response });
        return response;
    }

    async *chatStream(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage> {
        if (!this.delegate.chatStream) {
            throw new Error(`[ScenarioRecordingProvider] Underlying provider "${this.delegate.name}" does not support streaming`);
        }
        const chunks: StreamChunkInput[] = [];
        let index = 0;
        for await (const chunk of this.delegate.chatStream(messages, options)) {
            chunks.push({
                index,
                delta: chunk,
                timestamp: Date.now()
            });
            index++;
            yield chunk;
        }
        await this.recordStep(messages, options, { stream: chunks });
    }

    async generateResponse(payload: ProviderRequest): Promise<RawProviderResponse> {
        const result = await this.delegate.generateResponse(payload);
        await this.recordStep(payload.messages, { model: payload.model }, { raw: result });
        return result;
    }

    supportsTools(): boolean {
        return this.delegate.supportsTools();
    }

    validateConfig(): boolean {
        return this.delegate.validateConfig();
    }

    dispose?(): Promise<void> {
        return this.delegate.dispose?.();
    }

    close?(): Promise<void> {
        return this.delegate.close?.();
    }

    private async recordStep(messages: UniversalMessage[], options: ChatOptions | undefined, response: RecordingResponseInput): Promise<void> {
        const serializedMessages = serializeMessages(messages);
        const serializedOptions = serializeChatOptions(options);
        const serializedResponse = serializeResponseSnapshot(response);

        const step: ScenarioStep = {
            stepId: `step_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            requestHash: createRequestHash(messages, options),
            request: {
                messages: serializedMessages,
                options: serializedOptions,
                metadata: this.options.metadata ? structuredClone(this.options.metadata) : undefined
            },
            response: serializedResponse,
            timestamp: Date.now(),
            tags: this.options.tags,
            providerInfo: {
                name: this.delegate.name,
                version: this.delegate.version
            }
        };
        await this.options.store.appendStep(this.options.scenarioId, step);
    }
}

class ScenarioMockAIProvider implements AIProvider {
    readonly name: string;
    readonly version: string;
    private pointer = 0;

    constructor(private readonly options: ScenarioMockProviderOptions) {
        this.name = options.providerName ?? 'openai';
        this.version = options.providerVersion ?? 'mock-scenario';
    }

    async chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage> {
        const step = await this.resolveStep(messages, options);
        const hydrated = hydrateResponseSnapshot(step.response);
        if (!hydrated.message) {
            throw new Error('[ScenarioMockAIProvider] Recorded scenario does not contain a message response for this step.');
        }
        return hydrated.message;
    }

    async *chatStream(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage> {
        const step = await this.resolveStep(messages, options);
        const hydrated = hydrateResponseSnapshot(step.response);
        if (!hydrated.stream) {
            throw new Error('[ScenarioMockAIProvider] Recorded scenario does not contain stream data for this step.');
        }
        for (const chunk of hydrated.stream) {
            yield chunk.delta;
        }
    }

    async generateResponse(payload: ProviderRequest): Promise<RawProviderResponse> {
        const step = await this.resolveStep(payload.messages, undefined);
        const hydrated = hydrateResponseSnapshot(step.response);
        if (!hydrated.raw) {
            throw new Error('[ScenarioMockAIProvider] Recorded scenario does not include raw response data.');
        }
        return hydrated.raw;
    }

    supportsTools(): boolean {
        return true;
    }

    validateConfig(): boolean {
        return true;
    }

    private async resolveStep(messages: UniversalMessage[], options?: ChatOptions): Promise<ScenarioStep | undefined> {
        if (this.options.strategy === 'sequential') {
            const steps = await this.options.store.listSteps(this.options.scenarioId);
            if (this.pointer >= steps.length) {
                throw new Error(`[ScenarioMockAIProvider] No more recorded steps available for scenario "${this.options.scenarioId}".`);
            }
            const step = steps[this.pointer];
            this.pointer += 1;
            return step;
        }

        const hash = createRequestHash(messages, options);
        const step = await this.options.store.findStepByHash(this.options.scenarioId, hash);
        if (!step) {
            this.debugHashMiss(hash, messages, options);
            throw new Error(`[ScenarioMockAIProvider] Unable to find recorded step for hash "${hash}".`);
        }
        return step;
    }

    private debugHashMiss(hash: string, messages: UniversalMessage[], options?: ChatOptions): void {
        const debugEnabled = process.env.SCENARIO_DEBUG_HASH_MISS === '1' || process.env.SCENARIO_DEBUG_HASH_MISS === 'true';
        if (!debugEnabled) {
            return;
        }
        // eslint-disable-next-line no-console -- Explicit debug output controlled by env flag
        console.error('[ScenarioMockAIProvider] Hash miss', {
            scenarioId: this.options.scenarioId,
            hash,
            messageCount: messages.length,
            optionKeys: options ? Object.keys(options) : []
        });
    }
}


