import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentFactory, type AgentFactoryOptions, type AgentLifecycleEvents } from './agent-factory';
import type { AgentInterface, AgentConfig, AgentTemplate } from '../interfaces/agent';
import { ConfigurationError, ValidationError } from '../utils/errors';
import { Robota } from '../agents/robota';
import { BaseAIProvider } from '../abstracts/base-ai-provider';
import type { UniversalMessage } from './conversation-history-manager';
import type { ChatOptions } from '../interfaces/provider';

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

describe.skip('AgentFactory', () => {
    let factory: AgentFactory;
    const mockLifecycleEvents: AgentLifecycleEvents = {
        beforeCreate: vi.fn(),
        afterCreate: vi.fn(),
        onCreateError: vi.fn(),
        onDestroy: vi.fn()
    };

    const mockTemplate: AgentTemplate = {
        id: 'test-template',
        name: 'Test Template',
        description: 'A test template',
        version: '1.0.0',
        category: 'general',
        tags: ['test'],
        config: {
            name: 'TemplateAgent',
            aiProviders: [new MockAIProvider()],
            defaultModel: {
                provider: 'mock-provider',
                model: 'gpt-3.5-turbo'
            }
        }
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        factory = new AgentFactory({
            defaultModel: 'gpt-4',
            defaultProvider: 'openai',
            maxConcurrentAgents: 5,
            strictValidation: false // Disabled for simpler testing
        }, mockLifecycleEvents);
        await factory.initialize();
        factory.registerTemplate(mockTemplate);
    });

    afterEach(async () => {
        // Clean up any active agents
        const activeAgents = factory.getActiveAgents();
        for (const [agentId, agent] of activeAgents) {
            await factory.destroyAgent(agentId);
        }
    });

    describe('Initialization', () => {
        it('should initialize successfully', async () => {
            const newFactory = new AgentFactory();
            await expect(newFactory.initialize()).resolves.not.toThrow();
        });

        it('should not throw if initialized multiple times', async () => {
            await expect(factory.initialize()).resolves.not.toThrow();
            await expect(factory.initialize()).resolves.not.toThrow();
        });
    });

    describe('Agent Creation', () => {
        const basicConfig: Partial<AgentConfig> = {
            name: 'TestAgent',
            aiProviders: [new MockAIProvider()],
            defaultModel: {
                provider: 'mock-provider',
                model: 'gpt-3.5-turbo'
            }
        };

        it('should create agent successfully', async () => {
            const agent = await factory.createAgent(Robota, basicConfig) as Robota;

            expect(agent).toBeInstanceOf(Robota);
            expect(agent.name).toBe('TestAgent');
            const stats = agent.getStats();
            expect(stats.currentProvider).toBe('mock-provider');
        });

        it('should apply default configuration', async () => {
            const agent = await factory.createAgent(Robota, {
                name: 'TestAgent',
                aiProviders: [new MockAIProvider()],
                defaultModel: {
                    provider: 'mock-provider',
                    model: 'gpt-4'
                }
            });

            const model = agent.getModel();
            expect(model.model).toBe('gpt-4'); // Default
            expect(model.provider).toBe('mock-provider'); // From provider
        });

        it('should track active agents', async () => {
            const agent1 = await factory.createAgent(Robota, { ...basicConfig, name: 'Agent1' });
            const agent2 = await factory.createAgent(Robota, { ...basicConfig, name: 'Agent2' });

            const activeAgents = factory.getActiveAgents();
            expect(activeAgents.size).toBe(2);
        });

        it('should enforce concurrent agent limit', async () => {
            const promises = [];

            // Create 5 agents (at the limit)
            for (let i = 0; i < 5; i++) {
                promises.push(
                    factory.createAgent(Robota as any, { ...basicConfig, name: `Agent${i}` })
                );
            }
            await Promise.all(promises);

            // Try to create one more (should fail)
            await expect(
                factory.createAgent(Robota as any, { ...basicConfig, name: 'Agent6' })
            ).rejects.toThrow(ConfigurationError);
        });

        it('should call lifecycle events', async () => {
            const agent = await factory.createAgent(Robota as any, basicConfig);

            expect(mockLifecycleEvents.beforeCreate).toHaveBeenCalledWith(
                expect.objectContaining(basicConfig)
            );
            expect(mockLifecycleEvents.afterCreate).toHaveBeenCalledWith(
                agent,
                expect.objectContaining(basicConfig)
            );
        });
    });

    describe('Template Management', () => {
        it('should get template successfully', () => {
            const template = factory.getTemplate('test-template');
            expect(template).toEqual(mockTemplate);
        });

        it('should create agent from template', async () => {
            const agent = await factory.createFromTemplate(Robota as any, 'test-template');

            expect(agent.name).toBe('TemplateAgent');
            expect(agent.model).toBe('gpt-3.5-turbo');
            expect(agent.provider).toBe('mock-provider');
        });

        it('should apply overrides to template', async () => {
            const overrides = { name: 'OverriddenAgent', model: 'gpt-4' };
            const agent = await factory.createFromTemplate(Robota as any, 'test-template', overrides);

            expect(agent.name).toBe('OverriddenAgent');
            expect(agent.model).toBe('gpt-4');
            expect(agent.provider).toBe('mock-provider'); // From template
        });

        it('should throw error for non-existent template', async () => {
            await expect(
                factory.createFromTemplate(Robota as any, 'non-existent')
            ).rejects.toThrow(ConfigurationError);
        });

        it('should unregister template', () => {
            expect(factory.unregisterTemplate('test-template')).toBe(true);
            expect(factory.getTemplate('test-template')).toBeUndefined();
            expect(factory.unregisterTemplate('test-template')).toBe(false);
        });

        it('should get all templates', () => {
            const templates = factory.getTemplates();
            expect(templates.length).toBeGreaterThan(0);
            expect(templates.find(t => t.id === 'test-template')).toBeDefined();
        });
    });

    describe('Agent Lifecycle Management', () => {
        it('should destroy agent successfully', async () => {
            const agent = await factory.createAgent(Robota as any, {
                name: 'TestAgent',
                aiProviders: [new MockAIProvider()],
                defaultModel: {
                    provider: 'mock-provider',
                    model: 'gpt-3.5-turbo'
                }
            });

            const activeAgents = factory.getActiveAgents();
            expect(activeAgents.size).toBe(1);

            const agentId = [...activeAgents.keys()][0];
            const destroyed = await factory.destroyAgent(agentId);

            expect(destroyed).toBe(true);
            expect(factory.getActiveAgents().size).toBe(0);
            expect(mockLifecycleEvents.onDestroy).toHaveBeenCalledWith(agentId);
        });

        it('should return false when destroying non-existent agent', async () => {
            const destroyed = await factory.destroyAgent('non-existent');
            expect(destroyed).toBe(false);
        });
    });

    describe('Statistics and Monitoring', () => {
        it('should track creation statistics', async () => {
            // Create a custom configured agent
            const agent1 = await factory.createAgent(Robota as any, {
                name: 'Agent1',
                aiProviders: [new MockAIProvider()],
                defaultModel: {
                    provider: 'mock-provider',
                    model: 'gpt-3.5-turbo'
                }
            });

            // Create an agent from template
            const agent2 = await factory.createFromTemplate(Robota as any, 'test-template');

            const stats = factory.getCreationStats();
            expect(stats.totalCreated).toBe(2);
            expect(stats.activeCount).toBe(2);
            expect(stats.fromTemplates).toBe(1);
            expect(stats.customConfigured).toBe(1);
            expect(stats.templateUsageRatio).toBe(0.5); // 1/2 = 0.5
        });

        it('should update active count when agents are destroyed', async () => {
            const agent = await factory.createAgent(Robota as any, {
                name: 'TestAgent',
                aiProviders: [new MockAIProvider()],
                defaultModel: {
                    provider: 'mock-provider',
                    model: 'gpt-3.5-turbo'
                }
            });

            let stats = factory.getCreationStats();
            expect(stats.activeCount).toBe(1);

            const agentId = [...factory.getActiveAgents().keys()][0];
            await factory.destroyAgent(agentId);

            stats = factory.getCreationStats();
            expect(stats.activeCount).toBe(0);
            expect(stats.totalCreated).toBe(1); // Still counts total
        });
    });

    describe('Configuration Validation', () => {
        it('should provide validation results', () => {
            const validConfig = {
                name: 'ValidAgent',
                model: 'gpt-3.5-turbo',
                provider: 'openai'
            };

            const validation = factory.validateConfiguration(validConfig);
            expect(validation.isValid).toBe(true);
            expect(validation.errors).toHaveLength(0);
        });
    });
}); 