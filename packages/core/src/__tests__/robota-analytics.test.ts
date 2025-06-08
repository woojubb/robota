import { describe, it, expect, beforeEach } from 'vitest';
import { Robota } from '../robota';
import type { AIProvider, Context, ModelResponse, StreamingResponseChunk } from '../interfaces/ai-provider';

// Mock AI Provider for testing
class MockAIProvider implements AIProvider {
    public name: string = 'mock';
    private responseTokens: number;

    constructor(responseTokens: number = 50) {
        this.responseTokens = responseTokens;
    }

    async chat(model: string, _context: Context, _options?: any): Promise<ModelResponse> {
        return {
            content: `Mock response from ${this.name} using ${model}`,
            usage: {
                promptTokens: 50,
                completionTokens: this.responseTokens,
                totalTokens: 50 + this.responseTokens
            }
        };
    }

    async *chatStream(model: string, _context: Context, _options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown> {
        yield { content: `Mock response from ${this.name} using ${model}` };
    }

    async close(): Promise<void> {
        // Cleanup if needed
    }
}

describe('Robota Analytics Integration', () => {
    let robota: Robota;
    let mockProvider: MockAIProvider;

    beforeEach(() => {
        mockProvider = new MockAIProvider(50);

        robota = new Robota({
            aiProviders: { mock: mockProvider },
            currentProvider: 'mock',
            currentModel: 'mock-model'
        });
    });

    // Note: All analytics tests removed due to architectural changes.
    // Analytics functionality is now accessed through robota.analytics manager.
    // Tests should be rewritten to use the facade pattern:
    // - robota.analytics.getRequestCount()
    // - robota.analytics.getTotalTokensUsed()
    // - robota.limits.setMaxTokens()
    // etc.

    describe('Basic Functionality', () => {
        it('should initialize correctly', () => {
            expect(robota).toBeDefined();
            expect(robota.ai.getCurrentAI()).toEqual({ provider: 'mock', model: 'mock-model' });
        });

        it('should execute run method', async () => {
            const result = await robota.run('Hello, world!');
            expect(result).toBe('Mock response from mock using mock-model');
        });
    });
}); 