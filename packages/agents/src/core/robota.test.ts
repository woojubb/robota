import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Robota } from './robota';
import type { IAgentConfig, IRunOptions } from '../interfaces/agent';
import { AbstractAIProvider } from '../abstracts/abstract-ai-provider';
import { AbstractPlugin } from '../abstracts/abstract-plugin';
import { AbstractTool } from '../abstracts/abstract-tool';
import type { IToolSchema, IChatOptions } from '../interfaces/provider';
import type { IToolExecutionContext, IToolResult, TToolParameters } from '../interfaces/tool';
import type { TUniversalMessage } from '../interfaces/messages';
import { ConfigurationError } from '../utils/errors';

// Mock AI Provider that tracks calls
class TrackingProvider extends AbstractAIProvider {
    readonly name = 'tracking-provider';
    readonly version = '1.0.0';
    chatCalls: Array<{ messages: TUniversalMessage[]; options?: IChatOptions }> = [];

    constructor() {
        super();
    }

    async chat(messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage> {
        this.chatCalls.push({ messages, options });
        return {
            role: 'assistant',
            content: `Response to: ${messages[messages.length - 1]?.content ?? ''}`,
            timestamp: new Date()
        };
    }

    async *chatStream(messages: TUniversalMessage[], options?: IChatOptions): AsyncIterable<TUniversalMessage> {
        this.chatCalls.push({ messages, options });
        yield {
            role: 'assistant',
            content: 'Streamed chunk 1',
            timestamp: new Date()
        };
        yield {
            role: 'assistant',
            content: 'Streamed chunk 2',
            timestamp: new Date()
        };
    }
}

// Mock Tool with schema and execution tracking
class TrackingTool extends AbstractTool {
    executionCount = 0;

    override get schema(): IToolSchema {
        return {
            name: 'tracking-tool',
            description: 'A tool that tracks executions',
            parameters: {
                type: 'object' as const,
                properties: {
                    query: { type: 'string' as const }
                }
            }
        };
    }

    protected override async executeImpl(parameters: TToolParameters, _context: IToolExecutionContext): Promise<IToolResult> {
        this.executionCount++;
        const query = typeof parameters.query === 'string' ? parameters.query : '';
        return {
            success: true,
            data: `Tool result for: ${query}`
        };
    }
}

// Plugin that records hook invocations
class RecordingPlugin extends AbstractPlugin {
    override readonly name = 'recording-plugin';
    override readonly version = '1.0.0';
    beforeRunCalls: string[] = [];
    afterRunCalls: Array<{ input: string; response: string }> = [];

    override async beforeRun(input: string, _options?: IRunOptions): Promise<void> {
        this.beforeRunCalls.push(input);
    }

    override async afterRun(input: string, response: string, _options?: IRunOptions): Promise<void> {
        this.afterRunCalls.push({ input, response });
    }
}

function createConfig(overrides: Partial<IAgentConfig> = {}): IAgentConfig {
    const provider = new TrackingProvider();
    return {
        name: 'Test Agent',
        aiProviders: [provider],
        defaultModel: {
            provider: 'tracking-provider',
            model: 'test-model',
            temperature: 0.5
        },
        logging: { level: 'silent', enabled: false },
        ...overrides
    };
}

describe('Robota Core', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    // ----------------------------------------------------------------
    // System prompt handling
    // ----------------------------------------------------------------
    describe('system prompt', () => {
        it('should pass system message from config to provider', async () => {
            const provider = new TrackingProvider();
            const config = createConfig({
                aiProviders: [provider],
                systemMessage: 'You are a helpful assistant.'
            });

            const robota = new Robota(config);
            await robota.run('Hello');

            // The provider should receive the system message in the messages array
            expect(provider.chatCalls.length).toBeGreaterThan(0);
            const lastCall = provider.chatCalls[provider.chatCalls.length - 1];
            const systemMsg = lastCall.messages.find(m => m.role === 'system');
            expect(systemMsg).toBeDefined();
            expect(systemMsg?.content).toBe('You are a helpful assistant.');
        });

        it('should work without a system message', async () => {
            const provider = new TrackingProvider();
            const config = createConfig({
                aiProviders: [provider],
                defaultModel: {
                    provider: 'tracking-provider',
                    model: 'test-model'
                }
            });

            const robota = new Robota(config);
            const response = await robota.run('Hello');

            expect(response).toContain('Hello');
        });
    });

    // ----------------------------------------------------------------
    // Run execution flow
    // ----------------------------------------------------------------
    describe('run execution', () => {
        it('should return provider response from run', async () => {
            const robota = new Robota(createConfig());
            const response = await robota.run('What is 2+2?');

            expect(typeof response).toBe('string');
            expect(response.length).toBeGreaterThan(0);
        });

        it('should accumulate conversation history across runs', async () => {
            const robota = new Robota(createConfig());
            await robota.run('First message');
            await robota.run('Second message');

            const history = robota.getHistory();
            // Should have at least user + assistant pairs
            expect(history.length).toBeGreaterThanOrEqual(4);
        });

        it('should include previous messages when calling provider', async () => {
            const provider = new TrackingProvider();
            const config = createConfig({ aiProviders: [provider] });
            const robota = new Robota(config);

            await robota.run('First');
            await robota.run('Second');

            // The second call should include history from the first
            const secondCall = provider.chatCalls[provider.chatCalls.length - 1];
            const userMessages = secondCall.messages.filter(m => m.role === 'user');
            expect(userMessages.length).toBeGreaterThanOrEqual(2);
        });
    });

    // ----------------------------------------------------------------
    // Streaming
    // ----------------------------------------------------------------
    describe('runStream', () => {
        it('should yield chunks from the provider', async () => {
            const robota = new Robota(createConfig());
            const chunks: string[] = [];

            for await (const chunk of robota.runStream('Tell me something')) {
                chunks.push(chunk);
            }

            expect(chunks.length).toBeGreaterThan(0);
        });
    });

    // ----------------------------------------------------------------
    // Plugin lifecycle hooks
    // ----------------------------------------------------------------
    describe('plugin hooks', () => {
        it('should invoke beforeRun and afterRun hooks on plugins', async () => {
            const plugin = new RecordingPlugin();
            const config = createConfig({ plugins: [plugin] });

            const robota = new Robota(config);
            await robota.run('Test input');

            expect(plugin.beforeRunCalls.length).toBeGreaterThanOrEqual(1);
            expect(plugin.afterRunCalls.length).toBeGreaterThanOrEqual(1);
        });
    });

    // ----------------------------------------------------------------
    // Tool registration
    // ----------------------------------------------------------------
    describe('tool registration', () => {
        it('should register tools from config', async () => {
            const tool = new TrackingTool();
            const config = createConfig({ tools: [tool] });

            const robota = new Robota(config);
            await robota.run('test'); // trigger initialization

            const stats = robota.getStats();
            expect(stats.tools).toContain('tracking-tool');
        });

        it('should support updateTools after initialization', async () => {
            const tool1 = new TrackingTool();
            const config = createConfig({ tools: [tool1] });

            const robota = new Robota(config);
            await robota.run('init');

            const newTool = new TrackingTool();
            // Override schema name for distinction
            Object.defineProperty(newTool, 'schema', {
                get() {
                    return {
                        name: 'new-tracking-tool',
                        description: 'Updated tool',
                        parameters: { type: 'object' as const, properties: {} }
                    };
                }
            });

            const result = await robota.updateTools([newTool]);
            expect(result.version).toBeGreaterThan(1);
        });
    });

    // ----------------------------------------------------------------
    // getConfig and setModel
    // ----------------------------------------------------------------
    describe('configuration access', () => {
        it('should return config with getConfig', () => {
            const config = createConfig();
            const robota = new Robota(config);

            const retrieved = robota.getConfig();
            expect(retrieved.name).toBe('Test Agent');
            expect(retrieved.defaultModel.provider).toBe('tracking-provider');
        });

        it('should update model with setModel', async () => {
            const provider2 = new TrackingProvider();
            Object.defineProperty(provider2, 'name', { value: 'provider-2', writable: false });

            const config = createConfig({
                aiProviders: [new TrackingProvider(), provider2],
                defaultModel: {
                    provider: 'tracking-provider',
                    model: 'model-a'
                }
            });

            const robota = new Robota(config);
            await robota.run('init');

            robota.setModel({
                provider: 'provider-2',
                model: 'model-b',
                temperature: 0.9
            });

            const model = robota.getModel();
            expect(model.provider).toBe('provider-2');
            expect(model.model).toBe('model-b');
            expect(model.temperature).toBe(0.9);
        });

        it('should reject setModel with unknown provider', async () => {
            const robota = new Robota(createConfig());
            await robota.run('init');

            expect(() => robota.setModel({
                provider: 'nonexistent',
                model: 'x'
            })).toThrow(ConfigurationError);
        });
    });

    // ----------------------------------------------------------------
    // Statistics
    // ----------------------------------------------------------------
    describe('getStats', () => {
        it('should include all expected fields', async () => {
            const robota = new Robota(createConfig());
            await robota.run('test');

            const stats = robota.getStats();
            expect(stats.name).toBe('Test Agent');
            expect(stats.providers).toContain('tracking-provider');
            expect(stats.conversationId).toMatch(/^conv_/);
            expect(typeof stats.uptime).toBe('number');
            expect(stats.historyLength).toBeGreaterThanOrEqual(1);
        });
    });

    // ----------------------------------------------------------------
    // Destroy and cleanup
    // ----------------------------------------------------------------
    describe('destroy', () => {
        it('should clean up resources without error', async () => {
            const robota = new Robota(createConfig());
            await robota.run('test');

            await expect(robota.destroy()).resolves.not.toThrow();
        });

        it('should be safe to call destroy before any run', async () => {
            const robota = new Robota(createConfig());
            await expect(robota.destroy()).resolves.not.toThrow();
        });
    });

    // ----------------------------------------------------------------
    // Conversation ID
    // ----------------------------------------------------------------
    describe('conversation ID', () => {
        it('should use provided conversationId from config', async () => {
            const config = createConfig({ conversationId: 'custom-conv-123' });
            const robota = new Robota(config);
            await robota.run('test');

            const stats = robota.getStats();
            expect(stats.conversationId).toBe('custom-conv-123');
        });

        it('should generate unique IDs when not provided', async () => {
            const r1 = new Robota(createConfig());
            const r2 = new Robota(createConfig());
            await r1.run('a');
            await r2.run('b');

            expect(r1.getStats().conversationId).not.toBe(r2.getStats().conversationId);
        });
    });
});
