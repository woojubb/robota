import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AIProviders } from './ai-provider-manager';
import { BaseAIProvider } from '../abstracts/base-ai-provider';
import { ConfigurationError, ValidationError } from '../utils/errors';

// Mock AI Provider for testing
class MockAIProvider extends BaseAIProvider {
    name = 'mock-provider';
    models = ['model-1', 'model-2'];
    private _closed = false;

    constructor(name?: string, models?: string[]) {
        super();
        if (name) this.name = name;
        if (models) this.models = models;
    }

    supportsModel(model: string): boolean {
        return this.models.includes(model);
    }

    async generateResponse(request: any): Promise<any> {
        return { content: 'Mock response' };
    }

    async *generateStreamingResponse(request: any): AsyncGenerator<any, void, unknown> {
        yield { content: 'Mock response' };
    }

    async chat(model: string, context: any, options?: any): Promise<any> {
        return { content: 'Mock chat response' };
    }

    protected convertMessages(messages: any[]): any[] {
        return messages;
    }

    async close(): Promise<void> {
        this._closed = true;
    }

    get isClosed(): boolean {
        return this._closed;
    }
}

describe('AIProviders Manager', () => {
    let aiProviders: AIProviders;
    let mockProvider: MockAIProvider;

    beforeEach(async () => {
        aiProviders = new AIProviders();
        await aiProviders.initialize();
        mockProvider = new MockAIProvider();
    });

    afterEach(async () => {
        await aiProviders.dispose();
        vi.clearAllMocks();
    });

    describe('Instance Independence (No Singletons)', () => {
        it('should create independent instances', async () => {
            const aiProviders1 = new AIProviders();
            const aiProviders2 = new AIProviders();

            await aiProviders1.initialize();
            await aiProviders2.initialize();

            // Add provider to first instance only
            aiProviders1.addProvider('test-provider', mockProvider);

            expect(aiProviders1.getProviderNames()).toContain('test-provider');
            expect(aiProviders2.getProviderNames()).not.toContain('test-provider');

            await aiProviders1.dispose();
            await aiProviders2.dispose();
        });

        it('should maintain separate state across instances', async () => {
            const aiProviders1 = new AIProviders();
            const aiProviders2 = new AIProviders();

            await aiProviders1.initialize();
            await aiProviders2.initialize();

            const provider1 = new MockAIProvider('provider-1');
            const provider2 = new MockAIProvider('provider-2');

            aiProviders1.addProvider('provider-1', provider1);
            aiProviders1.setCurrentProvider('provider-1', 'model-1');

            aiProviders2.addProvider('provider-2', provider2);
            aiProviders2.setCurrentProvider('provider-2', 'model-2');

            expect(aiProviders1.getCurrentProvider()?.provider).toBe('provider-1');
            expect(aiProviders2.getCurrentProvider()?.provider).toBe('provider-2');

            await aiProviders1.dispose();
            await aiProviders2.dispose();
        });
    });

    describe('Provider Registration', () => {
        it('should register valid providers', () => {
            expect(() => {
                aiProviders.addProvider('test-provider', mockProvider);
            }).not.toThrow();

            expect(aiProviders.getProviderNames()).toContain('test-provider');
            expect(aiProviders.getProvider('test-provider')).toBe(mockProvider);
        });

        it('should validate provider names', () => {
            expect(() => {
                aiProviders.addProvider('', mockProvider);
            }).toThrow(ValidationError);

            expect(() => {
                aiProviders.addProvider('invalid name!', mockProvider);
            }).toThrow(ValidationError);
        });

        it('should validate provider objects', () => {
            expect(() => {
                aiProviders.addProvider('test', null as any);
            }).toThrow(ValidationError);

            expect(() => {
                aiProviders.addProvider('test', {} as any);
            }).toThrow(ValidationError);
        });

        it('should allow provider override with warning', () => {
            const provider1 = new MockAIProvider('provider-1');
            const provider2 = new MockAIProvider('provider-2');

            aiProviders.addProvider('test-provider', provider1);
            expect(aiProviders.getProvider('test-provider')).toBe(provider1);

            // Override should work but log warning
            aiProviders.addProvider('test-provider', provider2);
            expect(aiProviders.getProvider('test-provider')).toBe(provider2);
        });
    });

    describe('Provider Removal', () => {
        it('should remove providers correctly', async () => {
            const closeSpy = vi.spyOn(mockProvider, 'close');

            aiProviders.addProvider('test-provider', mockProvider);
            expect(aiProviders.getProviderNames()).toContain('test-provider');

            aiProviders.removeProvider('test-provider');

            expect(aiProviders.getProviderNames()).not.toContain('test-provider');
            expect(aiProviders.getProvider('test-provider')).toBeUndefined();

            // Should call close method if available
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(closeSpy).toHaveBeenCalled();
        });

        it('should clear current provider when removed', () => {
            aiProviders.addProvider('test-provider', mockProvider);
            aiProviders.setCurrentProvider('test-provider', 'model-1');

            expect(aiProviders.getCurrentProvider()?.provider).toBe('test-provider');

            aiProviders.removeProvider('test-provider');

            expect(aiProviders.getCurrentProvider()).toBeUndefined();
        });

        it('should handle removing non-existent providers gracefully', () => {
            expect(() => {
                aiProviders.removeProvider('non-existent');
            }).not.toThrow();
        });
    });

    describe('Current Provider Management', () => {
        beforeEach(() => {
            aiProviders.addProvider('test-provider', mockProvider);
        });

        it('should set current provider and model', () => {
            aiProviders.setCurrentProvider('test-provider', 'model-1');

            const current = aiProviders.getCurrentProvider();
            expect(current?.provider).toBe('test-provider');
            expect(current?.model).toBe('model-1');
        });

        it('should validate provider exists before setting current', () => {
            expect(() => {
                aiProviders.setCurrentProvider('non-existent', 'model-1');
            }).toThrow(ConfigurationError);
        });

        it('should validate model is supported', () => {
            expect(() => {
                aiProviders.setCurrentProvider('test-provider', 'unsupported-model');
            }).toThrow(ConfigurationError);
        });

        it('should return undefined when no current provider set', () => {
            expect(aiProviders.getCurrentProvider()).toBeUndefined();
        });

        it('should provide current provider instance', () => {
            aiProviders.setCurrentProvider('test-provider', 'model-1');

            const instance = aiProviders.getCurrentProviderInstance();
            expect(instance).toBe(mockProvider);
        });
    });

    describe('Configuration Status', () => {
        it('should report not configured initially', () => {
            expect(aiProviders.isConfigured()).toBe(false);
        });

        it('should report configured when provider and model are set', () => {
            aiProviders.addProvider('test-provider', mockProvider);
            aiProviders.setCurrentProvider('test-provider', 'model-1');

            expect(aiProviders.isConfigured()).toBe(true);
        });

        it('should report not configured if current provider is removed', () => {
            aiProviders.addProvider('test-provider', mockProvider);
            aiProviders.setCurrentProvider('test-provider', 'model-1');

            expect(aiProviders.isConfigured()).toBe(true);

            aiProviders.removeProvider('test-provider');

            expect(aiProviders.isConfigured()).toBe(false);
        });
    });

    describe('Provider Query Methods', () => {
        beforeEach(() => {
            const provider1 = new MockAIProvider('provider-1', ['model-a', 'model-b']);
            const provider2 = new MockAIProvider('provider-2', ['model-c']);

            aiProviders.addProvider('provider-1', provider1);
            aiProviders.addProvider('provider-2', provider2);
        });

        it('should return all providers', () => {
            const providers = aiProviders.getProviders();

            expect(Object.keys(providers)).toHaveLength(2);
            expect(providers['provider-1'].name).toBe('provider-1');
            expect(providers['provider-2'].name).toBe('provider-2');
        });

        it('should return provider names', () => {
            const names = aiProviders.getProviderNames();

            expect(names).toHaveLength(2);
            expect(names).toContain('provider-1');
            expect(names).toContain('provider-2');
        });

        it('should return available models for provider', () => {
            const models = aiProviders.getAvailableModels('provider-1');

            expect(models).toHaveLength(2);
            expect(models).toContain('model-a');
            expect(models).toContain('model-b');
        });

        it('should return empty array for non-existent provider models', () => {
            const models = aiProviders.getAvailableModels('non-existent');

            expect(models).toHaveLength(0);
        });

        it('should find providers by pattern', () => {
            const matchingProviders = aiProviders.getProvidersByPattern(/provider-[12]/);

            expect(Object.keys(matchingProviders)).toHaveLength(2);

            const provider1Only = aiProviders.getProvidersByPattern('provider-1');
            expect(Object.keys(provider1Only)).toHaveLength(1);
            expect(provider1Only['provider-1']).toBeDefined();
        });

        it('should check streaming support', () => {
            // Mock provider has streaming support
            expect(aiProviders.supportsStreaming('provider-1')).toBe(true);

            // Non-existent provider
            expect(aiProviders.supportsStreaming('non-existent')).toBe(false);

            // Current provider check
            aiProviders.setCurrentProvider('provider-1', 'model-a');
            expect(aiProviders.supportsStreaming()).toBe(true);
        });

        it('should return provider count', () => {
            expect(aiProviders.getProviderCount()).toBe(2);

            aiProviders.removeProvider('provider-1');
            expect(aiProviders.getProviderCount()).toBe(1);
        });
    });

    describe('Lifecycle Management', () => {
        it('should enforce initialization before operations', async () => {
            const uninitializedManager = new AIProviders();

            expect(() => {
                uninitializedManager.addProvider('test', mockProvider);
            }).toThrow();

            await uninitializedManager.dispose();
        });

        it('should cleanup all providers on dispose', async () => {
            const provider1 = new MockAIProvider('provider-1');
            const provider2 = new MockAIProvider('provider-2');

            const closeSpy1 = vi.spyOn(provider1, 'close');
            const closeSpy2 = vi.spyOn(provider2, 'close');

            aiProviders.addProvider('provider-1', provider1);
            aiProviders.addProvider('provider-2', provider2);
            aiProviders.setCurrentProvider('provider-1', 'model-1');

            await aiProviders.dispose();

            expect(closeSpy1).toHaveBeenCalled();
            expect(closeSpy2).toHaveBeenCalled();
            expect(aiProviders.getProviderCount()).toBe(0);
            expect(aiProviders.getCurrentProvider()).toBeUndefined();
        });
    });
}); 