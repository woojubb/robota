import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Robota } from '../agents/robota';
import type { RobotaConfig } from '../agents/robota';
import { BaseAIProvider } from '../abstracts/base-ai-provider';
import { FunctionTool } from '../tools/implementations/function-tool';
import type { ToolSchema } from '../interfaces/provider';

// Mock AI Provider for testing
class MockAIProvider extends BaseAIProvider {
    name = 'mock-provider';
    models = ['mock-model'];

    constructor() {
        super();
    }

    supportsModel(model: string): boolean {
        return this.models.includes(model);
    }

    async generateResponse(request: any): Promise<any> {
        return {
            content: 'Mock response',
            usage: { totalTokens: 10 }
        };
    }

    async *generateStreamingResponse(request: any): AsyncGenerator<any, void, unknown> {
        yield { content: 'Mock response', isComplete: true };
    }

    async chat(model: string, context: any, options?: any): Promise<any> {
        return this.generateResponse({ model, context, options });
    }

    protected convertMessages(messages: any[]): any[] {
        return messages;
    }
}

describe('Duplicate Prevention', () => {
    let mockProvider: MockAIProvider;
    let config: RobotaConfig;
    let robota: Robota;

    beforeEach(() => {
        mockProvider = new MockAIProvider();

        config = {
            name: 'Test Robota',
            model: 'mock-model',
            provider: 'mock-provider',
            aiProviders: {
                'mock-provider': mockProvider
            },
            currentProvider: 'mock-provider',
            currentModel: 'mock-model',
            tools: [],
            plugins: [],
            logging: {
                level: 'warn', // Show warnings for duplicate prevention
                enabled: true
            }
        };

        robota = new Robota(config);
    });

    describe('Tool Registration Duplicate Prevention', () => {
        it('should prevent duplicate tool registration', async () => {
            const testTool = new FunctionTool(
                {
                    name: 'testTool',
                    description: 'A test tool',
                    parameters: {
                        type: 'object',
                        properties: {},
                        required: []
                    }
                },
                async () => ({ result: 'success' })
            );

            // Initialize robota first to ensure tools manager is ready
            await robota.run('Initialize test');

            // First registration should succeed
            robota.registerTool(testTool);
            let stats = robota.getStats();
            expect(stats.tools).toContain('testTool');
            expect(stats.tools.length).toBe(1);

            // Second registration should be skipped (no error, no duplicate)
            robota.registerTool(testTool);
            stats = robota.getStats();
            expect(stats.tools).toContain('testTool');
            expect(stats.tools.length).toBe(1); // Still only one tool
        });
    });

    describe('System Message Duplicate Prevention', () => {
        it('should prevent duplicate system messages', async () => {
            const configWithSystemMessage = {
                ...config,
                systemMessage: 'You are a helpful assistant.'
            };

            const robotaWithSystem = new Robota(configWithSystemMessage);

            // Run twice to check for duplicate system messages
            await robotaWithSystem.run('First message');
            await robotaWithSystem.run('Second message');

            const history = robotaWithSystem.getHistory();

            // Count system messages - should only have one
            const systemMessages = history.filter(msg => msg.role === 'system');
            expect(systemMessages.length).toBe(1);
            expect(systemMessages[0].content).toBe('You are a helpful assistant.');
        });
    });
}); 