import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIProviders } from './ai-provider-manager';
import { AbstractAIProvider } from '../abstracts/abstract-ai-provider';
import type { TUniversalMessage } from '../interfaces/messages';
import type { IChatOptions } from '../interfaces/provider';
import { ConfigurationError, ValidationError } from '../utils/errors';

// Mock logger used by AIProviders internally
vi.mock('../utils/logger', () => ({
    Logger: vi.fn().mockImplementation(() => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    })),
    createLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        isDebugEnabled: vi.fn().mockReturnValue(false),
        setLevel: vi.fn(),
        getLevel: vi.fn().mockReturnValue('warn')
    }),
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    },
    SilentLogger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

/**
 * Mock AI provider that extends AbstractAIProvider for test usage.
 * Provides minimal chat implementation required by the IAIProvider contract.
 */
class MockAIProvider extends AbstractAIProvider {
    readonly name: string;
    readonly version = '1.0.0';

    constructor(providerName = 'mock-provider') {
        super();
        this.name = providerName;
    }

    async chat(_messages: TUniversalMessage[], _options?: IChatOptions): Promise<TUniversalMessage> {
        return {
            role: 'assistant',
            content: 'Mock response',
            timestamp: new Date()
        };
    }

    async *chatStream(_messages: TUniversalMessage[], _options?: IChatOptions): AsyncIterable<TUniversalMessage> {
        throw new Error('chatStream not implemented in MockAIProvider');
    }
}

/**
 * Mock AI provider that also supports streaming via chatStream.
 */
class MockStreamingProvider extends MockAIProvider {
    constructor(providerName = 'streaming-provider') {
        super(providerName);
    }

    override async *chatStream(_messages: TUniversalMessage[], _options?: IChatOptions): AsyncIterable<TUniversalMessage> {
        yield {
            role: 'assistant',
            content: 'Streaming chunk',
            timestamp: new Date()
        };
    }
}

/**
 * Mock AI provider with a close method to verify disposal behavior.
 */
class MockClosableProvider extends MockAIProvider {
    closeCalled = false;

    constructor(providerName = 'closable-provider') {
        super(providerName);
    }

    async close(): Promise<void> {
        this.closeCalled = true;
    }
}

describe('AIProviders (AI Provider Manager)', () => {
    let aiProviders: AIProviders;

    beforeEach(async () => {
        vi.clearAllMocks();
        aiProviders = new AIProviders();
        await aiProviders.initialize();
    });

    afterEach(async () => {
        await aiProviders.dispose();
    });

    // ----------------------------------------------------------------
    // 1. Initialization and Disposal
    // ----------------------------------------------------------------
    describe('Initialization and Disposal', () => {
        it('should initialize successfully', async () => {
            const manager = new AIProviders();
            await expect(manager.initialize()).resolves.not.toThrow();
            expect(manager.isInitialized()).toBe(true);
            await manager.dispose();
        });

        it('should dispose and clear providers and current selection', async () => {
            const provider = new MockAIProvider();
            aiProviders.addProvider('test', provider);
            aiProviders.setCurrentProvider('test', 'model-1');

            expect(aiProviders.getProviderCount()).toBe(1);
            expect(aiProviders.getCurrentProvider()).toBeDefined();

            await aiProviders.dispose();

            // After disposal the manager is no longer initialized
            expect(aiProviders.isInitialized()).toBe(false);

            // Re-initialize to verify state was cleared
            await aiProviders.initialize();
            expect(aiProviders.getProviderCount()).toBe(0);
            expect(aiProviders.getCurrentProvider()).toBeUndefined();
        });

        it('should call close on providers that have a close method during disposal', async () => {
            const closable = new MockClosableProvider('closable');
            aiProviders.addProvider('closable', closable);

            await aiProviders.dispose();

            expect(closable.closeCalled).toBe(true);
        });
    });

    // ----------------------------------------------------------------
    // 2. Provider Registration (addProvider)
    // ----------------------------------------------------------------
    describe('Provider Registration (addProvider)', () => {
        it('should register a provider successfully', () => {
            const provider = new MockAIProvider();
            aiProviders.addProvider('openai', provider);

            expect(aiProviders.getProvider('openai')).toBe(provider);
            expect(aiProviders.getProviderCount()).toBe(1);
        });

        it('should throw ValidationError for invalid provider name', () => {
            const provider = new MockAIProvider();
            expect(() => aiProviders.addProvider('', provider)).toThrow(ValidationError);
        });

        it('should throw ValidationError for null provider', () => {
            expect(() => aiProviders.addProvider('test', null as never)).toThrow(ValidationError);
        });

        it('should throw ValidationError for undefined provider', () => {
            expect(() => aiProviders.addProvider('test', undefined as never)).toThrow(ValidationError);
        });

        it('should throw ValidationError for provider without name property', () => {
            const badProvider = { chat: vi.fn() } as never;
            expect(() => aiProviders.addProvider('test', badProvider)).toThrow(ValidationError);
        });

        it('should throw ValidationError for provider without chat method', () => {
            const badProvider = { name: 'bad' } as never;
            expect(() => aiProviders.addProvider('test', badProvider)).toThrow(ValidationError);
        });

        it('should warn but override when registering a duplicate provider name', () => {
            const provider1 = new MockAIProvider('p1');
            const provider2 = new MockAIProvider('p2');

            aiProviders.addProvider('shared', provider1);
            aiProviders.addProvider('shared', provider2);

            // The second provider should override the first
            expect(aiProviders.getProvider('shared')).toBe(provider2);
            expect(aiProviders.getProviderCount()).toBe(1);
        });
    });

    // ----------------------------------------------------------------
    // 3. Provider Removal (removeProvider)
    // ----------------------------------------------------------------
    describe('Provider Removal (removeProvider)', () => {
        it('should remove an existing provider', () => {
            const provider = new MockAIProvider();
            aiProviders.addProvider('openai', provider);
            expect(aiProviders.getProviderCount()).toBe(1);

            aiProviders.removeProvider('openai');
            expect(aiProviders.getProvider('openai')).toBeUndefined();
            expect(aiProviders.getProviderCount()).toBe(0);
        });

        it('should warn but not throw when removing a non-existent provider', () => {
            expect(() => aiProviders.removeProvider('non-existent')).not.toThrow();
        });

        it('should clear current selection when removing the current provider', () => {
            const provider = new MockAIProvider();
            aiProviders.addProvider('openai', provider);
            aiProviders.setCurrentProvider('openai', 'gpt-4');
            expect(aiProviders.getCurrentProvider()).toBeDefined();

            aiProviders.removeProvider('openai');
            expect(aiProviders.getCurrentProvider()).toBeUndefined();
        });
    });

    // ----------------------------------------------------------------
    // 4. Current Provider (setCurrentProvider / getCurrentProvider)
    // ----------------------------------------------------------------
    describe('Current Provider (setCurrentProvider / getCurrentProvider)', () => {
        it('should set and get the current provider', () => {
            const provider = new MockAIProvider();
            aiProviders.addProvider('openai', provider);
            aiProviders.setCurrentProvider('openai', 'gpt-4');

            const current = aiProviders.getCurrentProvider();
            expect(current).toEqual({ provider: 'openai', model: 'gpt-4' });
        });

        it('should throw ConfigurationError when setting a non-existent provider', () => {
            expect(() => aiProviders.setCurrentProvider('missing', 'model-1')).toThrow(ConfigurationError);
        });

        it('should return undefined when no current provider is set', () => {
            expect(aiProviders.getCurrentProvider()).toBeUndefined();
        });

        it('should report isConfigured true when provider and model are set', () => {
            const provider = new MockAIProvider();
            aiProviders.addProvider('openai', provider);
            aiProviders.setCurrentProvider('openai', 'gpt-4');

            expect(aiProviders.isConfigured()).toBe(true);
        });

        it('should report isConfigured false when no current provider is set', () => {
            expect(aiProviders.isConfigured()).toBe(false);
        });
    });

    // ----------------------------------------------------------------
    // 5. Provider Queries
    // ----------------------------------------------------------------
    describe('Provider Queries', () => {
        let providerA: MockAIProvider;
        let providerB: MockStreamingProvider;

        beforeEach(() => {
            providerA = new MockAIProvider('provider-a');
            providerB = new MockStreamingProvider('provider-b');
            aiProviders.addProvider('alpha', providerA);
            aiProviders.addProvider('beta-stream', providerB);
        });

        it('getProvider should return provider for existing name', () => {
            expect(aiProviders.getProvider('alpha')).toBe(providerA);
        });

        it('getProvider should return undefined for non-existing name', () => {
            expect(aiProviders.getProvider('missing')).toBeUndefined();
        });

        it('getProviders should return record of all providers', () => {
            const providers = aiProviders.getProviders();
            expect(Object.keys(providers)).toHaveLength(2);
            expect(providers['alpha']).toBe(providerA);
            expect(providers['beta-stream']).toBe(providerB);
        });

        it('getProviderNames should return array of registered names', () => {
            const names = aiProviders.getProviderNames();
            expect(names).toEqual(expect.arrayContaining(['alpha', 'beta-stream']));
            expect(names).toHaveLength(2);
        });

        it('getProvidersByPattern should match with string pattern', () => {
            const matched = aiProviders.getProvidersByPattern('alpha');
            expect(Object.keys(matched)).toEqual(['alpha']);
        });

        it('getProvidersByPattern should match with RegExp pattern', () => {
            const matched = aiProviders.getProvidersByPattern(/^beta/);
            expect(Object.keys(matched)).toEqual(['beta-stream']);
        });

        it('getProvidersByPattern should return empty object when nothing matches', () => {
            const matched = aiProviders.getProvidersByPattern('zzz');
            expect(Object.keys(matched)).toHaveLength(0);
        });

        it('getProviderCount should return correct count', () => {
            expect(aiProviders.getProviderCount()).toBe(2);
        });

        it('supportsStreaming should return true for provider with chatStream', () => {
            expect(aiProviders.supportsStreaming('beta-stream')).toBe(true);
        });

        it('supportsStreaming should return false for provider without chatStream', () => {
            expect(aiProviders.supportsStreaming('alpha')).toBe(false);
        });

        it('supportsStreaming should use current provider when no name given', () => {
            aiProviders.setCurrentProvider('beta-stream', 'model-x');
            expect(aiProviders.supportsStreaming()).toBe(true);
        });

        it('supportsStreaming should return false when no provider name and no current', () => {
            expect(aiProviders.supportsStreaming()).toBe(false);
        });

        it('getCurrentProviderInstance should return instance when configured', () => {
            aiProviders.setCurrentProvider('alpha', 'model-1');
            expect(aiProviders.getCurrentProviderInstance()).toBe(providerA);
        });

        it('getCurrentProviderInstance should return undefined when not configured', () => {
            expect(aiProviders.getCurrentProviderInstance()).toBeUndefined();
        });
    });

    // ----------------------------------------------------------------
    // 6. Error States
    // ----------------------------------------------------------------
    describe('Error States', () => {
        it('should throw when calling addProvider before initialization', async () => {
            const manager = new AIProviders();
            const provider = new MockAIProvider();
            expect(() => manager.addProvider('test', provider)).toThrow('AIProviders is not initialized');
        });

        it('should throw when calling removeProvider before initialization', () => {
            const manager = new AIProviders();
            expect(() => manager.removeProvider('test')).toThrow('AIProviders is not initialized');
        });

        it('should throw when calling getProvider before initialization', () => {
            const manager = new AIProviders();
            expect(() => manager.getProvider('test')).toThrow('AIProviders is not initialized');
        });

        it('should throw when calling getProviders before initialization', () => {
            const manager = new AIProviders();
            expect(() => manager.getProviders()).toThrow('AIProviders is not initialized');
        });

        it('should throw when calling setCurrentProvider before initialization', () => {
            const manager = new AIProviders();
            expect(() => manager.setCurrentProvider('test', 'model')).toThrow('AIProviders is not initialized');
        });

        it('should throw when calling getCurrentProvider before initialization', () => {
            const manager = new AIProviders();
            expect(() => manager.getCurrentProvider()).toThrow('AIProviders is not initialized');
        });

        it('should throw when calling isConfigured before initialization', () => {
            const manager = new AIProviders();
            expect(() => manager.isConfigured()).toThrow('AIProviders is not initialized');
        });

        it('should throw when calling getProviderNames before initialization', () => {
            const manager = new AIProviders();
            expect(() => manager.getProviderNames()).toThrow('AIProviders is not initialized');
        });

        it('should throw when calling getProvidersByPattern before initialization', () => {
            const manager = new AIProviders();
            expect(() => manager.getProvidersByPattern('test')).toThrow('AIProviders is not initialized');
        });

        it('should throw when calling getProviderCount before initialization', () => {
            const manager = new AIProviders();
            expect(() => manager.getProviderCount()).toThrow('AIProviders is not initialized');
        });

        it('should throw when calling supportsStreaming before initialization', () => {
            const manager = new AIProviders();
            expect(() => manager.supportsStreaming('test')).toThrow('AIProviders is not initialized');
        });
    });
});
