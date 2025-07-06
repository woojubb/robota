import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Robota } from './robota';
import type { AgentConfig } from '../interfaces/agent';
import { BaseAgent } from '../abstracts/base-agent';
import type { AgentInterface } from '../interfaces/agent';
import { BasePlugin } from '../abstracts/base-plugin';
import { BaseTool } from '../abstracts/base-tool';
import { BaseAIProvider } from '../abstracts/base-ai-provider';
import type { ToolSchema, ChatOptions } from '../interfaces/provider';
import type { ToolParameters, ToolResult } from '../interfaces/tool';
import type { UniversalMessage } from '../managers/conversation-history-manager';

import { ConfigurationError, ValidationError } from '../utils/errors';

// Mock AI Provider for testing
class MockAIProvider extends BaseAIProvider {
    readonly name = 'mock-provider';
    readonly version = '1.0.0';

    constructor() {
        super();
    }

    async chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage> {
        return {
            role: 'assistant',
            content: 'Mock response',
            timestamp: new Date()
        };
    }

    async *chatStream(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage> {
        yield {
            role: 'assistant',
            content: 'Mock response',
            timestamp: new Date()
        };
    }
}

// Second Mock AI Provider for multi-provider testing
class MockAIProvider2 extends BaseAIProvider {
    readonly name = 'mock-provider-2';
    readonly version = '1.0.0';

    constructor() {
        super();
    }

    async chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage> {
        return {
            role: 'assistant',
            content: 'Mock response from provider 2',
            timestamp: new Date()
        };
    }

    async *chatStream(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage> {
        yield {
            role: 'assistant',
            content: 'Mock response from provider 2',
            timestamp: new Date()
        };
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

    async execute(parameters: ToolParameters): Promise<ToolResult> {
        return {
            success: true,
            data: `Mock tool executed with: ${(parameters as Record<string, string | number | boolean>).input || 'no input'}`
        };
    }

    validateParameters(parameters: ToolParameters): { isValid: boolean; errors: string[] } {
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

describe('Robota Class - New Configuration API', () => {
    let mockProvider: MockAIProvider;
    let mockProvider2: MockAIProvider2;
    let mockTool: MockTool;
    let mockPlugin: MockPlugin;
    let config: AgentConfig;

    beforeEach(() => {
        mockProvider = new MockAIProvider();
        mockProvider2 = new MockAIProvider2();
        mockTool = new MockTool();
        mockPlugin = new MockPlugin();

        config = {
            name: 'Test Robota',
            aiProviders: [mockProvider],
            defaultModel: {
                provider: 'mock-provider',
                model: 'mock-model',
                temperature: 0.7
            },
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

    describe('New Constructor Format', () => {
        it('should create instance with new configuration format', () => {
            const robota = new Robota(config);

            expect(robota).toBeInstanceOf(BaseAgent);
            expect(robota).toBeInstanceOf(Robota);
            expect(robota.name).toBe('Test Robota');
        });

        it('should validate required fields', () => {
            expect(() => new Robota({} as AgentConfig)).toThrow(ConfigurationError);

            expect(() => new Robota({
                name: 'Test',
                aiProviders: [],
                defaultModel: {
                    provider: 'test',
                    model: 'test'
                }
            })).toThrow(ConfigurationError);
        });

        it('should validate AI provider existence', () => {
            expect(() => new Robota({
                name: 'Test',
                aiProviders: [mockProvider],
                defaultModel: {
                    provider: 'non-existent-provider',
                    model: 'test-model'
                }
            })).toThrow(ConfigurationError);
        });

        it('should validate duplicate AI provider names', () => {
            const duplicateProvider = new MockAIProvider();

            expect(() => new Robota({
                name: 'Test',
                aiProviders: [mockProvider, duplicateProvider],
                defaultModel: {
                    provider: 'mock-provider',
                    model: 'test-model'
                }
            })).toThrow(ConfigurationError);
        });

        it('should support multiple AI providers', () => {
            const multiProviderConfig: AgentConfig = {
                name: 'Multi Provider Test',
                aiProviders: [mockProvider, mockProvider2],
                defaultModel: {
                    provider: 'mock-provider',
                    model: 'mock-model'
                }
            };

            const robota = new Robota(multiProviderConfig);
            expect(robota.name).toBe('Multi Provider Test');
        });
    });

    describe('Model Management - setModel() and getModel()', () => {
        it('should set and get model configuration', async () => {
            const robota = new Robota(config);
            await robota.run('initialize'); // Initialize the agent

            robota.setModel({
                provider: 'mock-provider',
                model: 'new-model',
                temperature: 0.9,
                maxTokens: 2000
            });

            const currentModel = robota.getModel();
            expect(currentModel.provider).toBe('mock-provider');
            expect(currentModel.model).toBe('new-model');
            expect(currentModel.temperature).toBe(0.9);
            expect(currentModel.maxTokens).toBe(2000);
        });

        it('should validate provider exists when setting model', async () => {
            const robota = new Robota(config);
            await robota.run('initialize'); // Initialize the agent

            expect(() => robota.setModel({
                provider: 'non-existent-provider',
                model: 'test-model'
            })).toThrow(ConfigurationError);
        });

        it('should switch between multiple providers', async () => {
            const multiProviderConfig: AgentConfig = {
                name: 'Multi Provider Test',
                aiProviders: [mockProvider, mockProvider2],
                defaultModel: {
                    provider: 'mock-provider',
                    model: 'mock-model'
                }
            };

            const robota = new Robota(multiProviderConfig);
            await robota.run('initialize'); // Initialize the agent

            // Initially should be mock-provider
            expect(robota.getModel().provider).toBe('mock-provider');

            // Switch to mock-provider-2
            robota.setModel({
                provider: 'mock-provider-2',
                model: 'new-model'
            });

            expect(robota.getModel().provider).toBe('mock-provider-2');
            expect(robota.getModel().model).toBe('new-model');
        });

        it('should preserve other model settings when switching providers', async () => {
            const multiProviderConfig: AgentConfig = {
                name: 'Multi Provider Test',
                aiProviders: [mockProvider, mockProvider2],
                defaultModel: {
                    provider: 'mock-provider',
                    model: 'mock-model',
                    temperature: 0.7,
                    maxTokens: 1000
                }
            };

            const robota = new Robota(multiProviderConfig);
            await robota.run('initialize'); // Initialize the agent

            robota.setModel({
                provider: 'mock-provider-2',
                model: 'new-model',
                temperature: 0.9,
                maxTokens: 2000,
                topP: 0.95
            });

            const currentModel = robota.getModel();
            expect(currentModel.provider).toBe('mock-provider-2');
            expect(currentModel.model).toBe('new-model');
            expect(currentModel.temperature).toBe(0.9);
            expect(currentModel.maxTokens).toBe(2000);
            expect(currentModel.topP).toBe(0.95);
        });
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
            expect(currentConfig.defaultModel.model).toBe('mock-model');
        });

        it('should reflect model changes in configuration', async () => {
            const robota = new Robota(config);
            await robota.run('initialize'); // Initialize the agent

            robota.setModel({
                provider: 'mock-provider',
                model: 'new-model',
                temperature: 0.8,
                maxTokens: 2000
            });

            const currentConfig = robota.getConfig();
            expect(currentConfig.defaultModel.model).toBe('new-model');
            expect(currentConfig.defaultModel.temperature).toBe(0.8);
            expect(currentConfig.defaultModel.maxTokens).toBe(2000);
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

    describe('Edge Cases and Error Handling', () => {
        it('should handle empty AI providers array', () => {
            expect(() => new Robota({
                name: 'Test',
                aiProviders: [],
                defaultModel: {
                    provider: 'test',
                    model: 'test'
                }
            })).toThrow(ConfigurationError);
        });

        it('should handle missing required model fields', () => {
            expect(() => new Robota({
                name: 'Test',
                aiProviders: [mockProvider],
                defaultModel: {
                    provider: 'mock-provider'
                } as any
            })).toThrow(ConfigurationError);
        });

        it('should handle setModel with missing required fields', async () => {
            const robota = new Robota(config);
            await robota.run('initialize'); // Initialize the agent

            expect(() => robota.setModel({
                provider: 'mock-provider'
            } as any)).toThrow(ConfigurationError);
        });

        it('should preserve original config when setModel fails', async () => {
            const robota = new Robota(config);
            await robota.run('initialize'); // Initialize the agent
            const originalModel = robota.getModel();

            expect(() => robota.setModel({
                provider: 'non-existent-provider',
                model: 'test-model'
            })).toThrow(ConfigurationError);

            // Original model should be preserved
            const currentModel = robota.getModel();
            expect(currentModel).toEqual(originalModel);
        });
    });
}); 