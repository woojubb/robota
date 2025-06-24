import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Robota } from './robota';
import type { RobotaConfig } from './robota';
import { BaseAgent } from '../abstracts/base-agent';
import type { AgentInterface } from '../interfaces/agent';
import { BasePlugin } from '../abstracts/base-plugin';
import { BaseTool } from '../abstracts/base-tool';
import { BaseAIProvider } from '../abstracts/base-ai-provider';
import type { ToolSchema } from '../interfaces/provider';
import { ConfigurationError, ValidationError } from '../utils/errors';

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

// Mock Tool for testing
class MockTool extends BaseTool {
    name = 'mock-tool';
    description = 'Mock tool for testing';

    constructor() {
        super();
    }

    get schema(): ToolSchema {
        return {
            name: this.name,
            description: this.description,
            parameters: {
                type: 'object' as const,
                properties: {
                    input: { type: 'string' as const }
                }
            }
        };
    }

    async execute(parameters: any): Promise<any> {
        return {
            success: true,
            data: `Mock tool executed with: ${parameters.input}`
        };
    }

    validateParameters(parameters: any): { isValid: boolean; errors: string[] } {
        return { isValid: true, errors: [] };
    }
}

// Mock Plugin for testing
class MockPlugin extends BasePlugin {
    name = 'mock-plugin';
    version = '1.0.0';

    async beforeRun(input: string): Promise<void> {
        // Mock hook implementation
    }

    async afterRun(input: string, response: string): Promise<void> {
        // Mock hook implementation
    }
}

describe('Robota Class - Core Functionality', () => {
    let mockProvider: MockAIProvider;
    let mockTool: MockTool;
    let mockPlugin: MockPlugin;
    let config: RobotaConfig;

    beforeEach(() => {
        mockProvider = new MockAIProvider();
        mockTool = new MockTool();
        mockPlugin = new MockPlugin();

        config = {
            name: 'Test Robota',
            model: 'mock-model',
            provider: 'mock-provider',
            aiProviders: {
                'mock-provider': mockProvider
            },
            currentProvider: 'mock-provider',
            currentModel: 'mock-model',
            tools: [mockTool],
            plugins: [mockPlugin],
            logging: {
                level: 'silent',
                enabled: false
            }
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Basic Architecture', () => {
        it('should extend BaseAgent and implement AgentInterface', () => {
            const robota = new Robota(config);

            expect(robota).toBeInstanceOf(BaseAgent);
            expect(robota).toBeInstanceOf(Robota);

            // Check AgentInterface implementation
            expect(typeof robota.run).toBe('function');
            expect(typeof robota.runStream).toBe('function');
            expect(typeof robota.getHistory).toBe('function');
            expect(typeof robota.clearHistory).toBe('function');
        });

        it('should create instance-specific managers (no singletons)', async () => {
            const robota1 = new Robota(config);
            const robota2 = new Robota({ ...config, name: 'Test Robota 2' });

            // Each instance should have independent managers
            expect(robota1).not.toBe(robota2);
            expect(robota1.name).not.toBe(robota2.name);

            // Initialize both to get stats
            await robota1.run('test');
            await robota2.run('test');

            // Verify independent conversation IDs
            const stats1 = robota1.getStats();
            const stats2 = robota2.getStats();
            expect(stats1.conversationId).not.toBe(stats2.conversationId);
        });

        it('should validate configuration on creation', () => {
            expect(() => new Robota({} as RobotaConfig)).toThrow();
        });

        it('should generate unique conversation ID', async () => {
            const robota1 = new Robota(config);
            const robota2 = new Robota(config);

            // Initialize both to get stats
            await robota1.run('test');
            await robota2.run('test');

            const stats1 = robota1.getStats();
            const stats2 = robota2.getStats();

            expect(stats1.conversationId).not.toBe(stats2.conversationId);
            expect(stats1.conversationId).toMatch(/^conv_\d+_[a-z0-9]+$/);
        });
    });

    describe('Manager Integration', () => {
        it('should register AI providers correctly', async () => {
            const robota = new Robota(config);

            // Simple test run
            const response = await robota.run('test');
            expect(response).toBe('Mock response');

            const stats = robota.getStats();
            expect(stats.providers).toContain('mock-provider');
            expect(stats.currentProvider).toBe('mock-provider');
        });

        it('should maintain conversation history', async () => {
            const robota = new Robota(config);

            await robota.run('Hello');

            const history = robota.getHistory();
            expect(history.length).toBeGreaterThan(0);
            expect(history[0].content).toBe('Hello');
        });

        it('should clear history when requested', async () => {
            const robota = new Robota(config);

            await robota.run('Hello');
            expect(robota.getHistory().length).toBeGreaterThan(0);

            robota.clearHistory();
            expect(robota.getHistory()).toHaveLength(0);
        });
    });

    describe('Configuration Management', () => {
        it('should return current configuration', () => {
            const robota = new Robota(config);

            const currentConfig = robota.getConfig();
            expect(currentConfig.name).toBe('Test Robota');
            expect(currentConfig.model).toBe('mock-model');
        });

        it('should update configuration at runtime', async () => {
            const robota = new Robota(config);

            robota.updateConfig({
                temperature: 0.8,
                maxTokens: 2000
            });

            const updatedConfig = robota.getConfig();
            expect(updatedConfig.temperature).toBe(0.8);
            expect(updatedConfig.maxTokens).toBe(2000);
        });
    });

    describe('Statistics and Monitoring', () => {
        it('should provide comprehensive stats after initialization', async () => {
            const robota = new Robota(config);

            // Initialize first by running
            await robota.run('test');

            const stats = robota.getStats();

            expect(stats).toHaveProperty('name');
            expect(stats).toHaveProperty('version');
            expect(stats).toHaveProperty('conversationId');
            expect(stats).toHaveProperty('providers');
            expect(stats).toHaveProperty('currentProvider');
            expect(stats).toHaveProperty('tools');
            expect(stats).toHaveProperty('plugins');
            expect(stats).toHaveProperty('historyLength');
            expect(stats).toHaveProperty('uptime');

            expect(stats.providers).toBeInstanceOf(Array);
            expect(stats.tools).toBeInstanceOf(Array);
            expect(stats.plugins).toBeInstanceOf(Array);
            expect(typeof stats.uptime).toBe('number');
        });

        it('should track uptime correctly', async () => {
            const robota = new Robota(config);

            // Initialize first
            await robota.run('test');

            const stats1 = robota.getStats();
            expect(stats1.uptime).toBeGreaterThanOrEqual(0);

            // Wait a bit more to ensure time passes
            await new Promise(resolve => setTimeout(resolve, 50));

            const stats2 = robota.getStats();
            expect(stats2.uptime).toBeGreaterThan(stats1.uptime);
        });
    });

    describe('Resource Management', () => {
        it('should properly cleanup resources on destroy', async () => {
            const robota = new Robota(config);

            // Initialize first
            await robota.run('test');

            await robota.destroy();

            // Should not throw errors after destruction
            expect(() => robota.getConfig()).not.toThrow();
        });

        it('should handle multiple destroy calls safely', async () => {
            const robota = new Robota(config);

            // Initialize first  
            await robota.run('test');

            await robota.destroy();
            await robota.destroy(); // Should not throw

            expect(true).toBe(true); // Test passes if no error thrown
        });
    });
}); 