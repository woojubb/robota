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

type ScenarioMode = 'record' | 'play' | 'none';

export interface ScenarioProviderFromEnvOptions {
    /**
     * Required for record mode. Must be omitted in play mode to avoid accidental real calls.
     */
    delegate?: AIProvider;
    store: ScenarioStore;
    tags?: string[];
    providerName?: string;
    providerVersion?: string;
    /**
     * Default strategy if SCENARIO_PLAY_STRATEGY is unset.
     */
    defaultPlayStrategy?: 'hash' | 'sequential';
    /**
     * Optional metadata recorded alongside steps (record mode only).
     */
    metadata?: Record<string, unknown>;
}

export type ScenarioProviderFromEnvResult =
    | { mode: 'none'; provider: AIProvider }
    | { mode: 'record'; provider: AIProvider }
    | { mode: 'play'; provider: AIProvider; assertNoUnusedSteps: () => Promise<void> };

function readEnvString(key: string): string | undefined {
    const raw = process.env[key];
    if (!raw) return undefined;
    const value = String(raw).trim();
    return value.length > 0 ? value : undefined;
}

function resolveModeFromEnv(): { mode: ScenarioMode; recordId?: string; playId?: string; playStrategy?: 'hash' | 'sequential' } {
    const recordId = readEnvString('SCENARIO_RECORD_ID');
    const playId = readEnvString('SCENARIO_PLAY_ID');

    if (recordId && playId) {
        throw new Error('[SCENARIO-GUARD] Both SCENARIO_RECORD_ID and SCENARIO_PLAY_ID are set. Choose exactly one.');
    }
    if (recordId) {
        return { mode: 'record', recordId };
    }
    if (playId) {
        const rawStrategy = readEnvString('SCENARIO_PLAY_STRATEGY');
        const playStrategy =
            rawStrategy === 'hash' || rawStrategy === 'sequential'
                ? rawStrategy
                : rawStrategy
                    ? (() => {
                        throw new Error(`[SCENARIO-GUARD] Invalid SCENARIO_PLAY_STRATEGY "${rawStrategy}". Use "hash" or "sequential".`);
                    })()
                    : undefined;
        return { mode: 'play', playId, playStrategy };
    }
    return { mode: 'none' };
}

/**
 * Create a scenario-aware provider based on environment variables.
 *
 * Strict rules (No-Fallback / fail-fast):
 * - record mode requires a real delegate provider
 * - play mode must NOT receive a real delegate provider (refuse to prevent accidental real calls)
 * - play mode can enforce "unused steps" = failure
 */
export function createScenarioProviderFromEnv(options: ScenarioProviderFromEnvOptions): ScenarioProviderFromEnvResult {
    const mode = resolveModeFromEnv();

    if (mode.mode === 'record') {
        if (!options.delegate) {
            throw new Error('[SCENARIO-GUARD] SCENARIO_RECORD_ID is set but no delegate provider was supplied.');
        }
        const provider = createScenarioRecordingProvider(options.delegate, {
            scenarioId: mode.recordId ?? '',
            store: options.store,
            tags: options.tags,
            metadata: options.metadata
        });
        return { mode: 'record', provider };
    }

    if (mode.mode === 'play') {
        if (options.delegate) {
            throw new Error('[SCENARIO-GUARD] SCENARIO_PLAY_ID is set. Refusing to accept a delegate provider (no real calls allowed).');
        }
        const strategy = mode.playStrategy ?? options.defaultPlayStrategy ?? 'sequential';
        const provider = createScenarioMockProvider({
            scenarioId: mode.playId ?? '',
            store: options.store,
            tags: options.tags,
            strategy,
            providerName: options.providerName,
            providerVersion: options.providerVersion
        });

        const assertNoUnusedSteps = async (): Promise<void> => {
            if (!(provider instanceof ScenarioMockAIProvider)) {
                throw new Error('[SCENARIO-GUARD] Internal error: expected ScenarioMockAIProvider in play mode.');
            }
            await provider.assertNoUnusedSteps();
        };

        return { mode: 'play', provider, assertNoUnusedSteps };
    }

    if (!options.delegate) {
        throw new Error('[SCENARIO-GUARD] No scenario env set; a delegate provider must be supplied.');
    }
    return { mode: 'none', provider: options.delegate };
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
    private usedStepIds = new Set<string>();

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
            this.usedStepIds.add(step.stepId);
            return step;
        }

        const hash = createRequestHash(messages, options);
        const step = await this.options.store.findStepByHash(this.options.scenarioId, hash);
        if (!step) {
            this.debugHashMiss(hash, messages, options);
            throw new Error(`[ScenarioMockAIProvider] Unable to find recorded step for hash "${hash}".`);
        }
        this.usedStepIds.add(step.stepId);
        return step;
    }

    async assertNoUnusedSteps(): Promise<void> {
        const steps = await this.options.store.listSteps(this.options.scenarioId);
        if (this.options.strategy === 'sequential') {
            const unused = steps.length - this.pointer;
            if (unused > 0) {
                throw new Error(
                    `[SCENARIO-UNUSED] ${unused} unused step(s) remain for scenario "${this.options.scenarioId}". ` +
                    `Consumed=${this.pointer}, Total=${steps.length}.`
                );
            }
            return;
        }

        const unusedSteps = steps.filter(step => !this.usedStepIds.has(step.stepId));
        if (unusedSteps.length > 0) {
            const sample = unusedSteps.slice(0, 3).map(step => step.stepId).join(', ');
            throw new Error(
                `[SCENARIO-UNUSED] ${unusedSteps.length} unused step(s) remain for scenario "${this.options.scenarioId}". ` +
                `Sample: ${sample}`
            );
        }
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


