import { describe, it, expect, vi, afterEach } from 'vitest';
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

    override async *chatStream(messages: TUniversalMessage[], options?: IChatOptions): AsyncIterable<TUniversalMessage> {
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

// A second provider with a different name
class SecondProvider extends AbstractAIProvider {
    readonly name = 'provider-2';
    readonly version = '1.0.0';

    async chat(messages: TUniversalMessage[]): Promise<TUniversalMessage> {
        return {
            role: 'assistant',
            content: `Provider-2: ${messages[messages.length - 1]?.content ?? ''}`,
            timestamp: new Date()
        };
    }

    override async *chatStream(): AsyncIterable<TUniversalMessage> {
        yield { role: 'assistant', content: 'chunk', timestamp: new Date() };
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

// A second tool with a different name
class AnotherTool extends AbstractTool {
    override get schema(): IToolSchema {
        return {
            name: 'another-tool',
            description: 'Another tool',
            parameters: { type: 'object' as const, properties: {} }
        };
    }

    protected override async executeImpl(): Promise<IToolResult> {
        return { success: true, data: 'ok' };
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
        it('should pass system message to provider via messages array', async () => {
            const provider = new TrackingProvider();
            const config = createConfig({
                aiProviders: [provider],
                systemMessage: 'You are a helpful assistant.'
            });

            const robota = new Robota(config);
            await robota.run('Hello');

            expect(provider.chatCalls).toHaveLength(1);
            const messages = provider.chatCalls[0].messages;
            const systemMsg = messages.find(m => m.role === 'system');
            expect(systemMsg).toBeDefined();
            expect(systemMsg?.content).toBe('You are a helpful assistant.');
        });

        it('should work without a system message', async () => {
            const provider = new TrackingProvider();
            const config = createConfig({ aiProviders: [provider] });

            const robota = new Robota(config);
            const response = await robota.run('Hello');

            expect(response).toBe('Response to: Hello');
        });
    });

    // ----------------------------------------------------------------
    // Run execution flow
    // ----------------------------------------------------------------
    describe('run execution', () => {
        it('should return provider response from run', async () => {
            const robota = new Robota(createConfig());
            const response = await robota.run('What is 2+2?');

            expect(response).toBe('Response to: What is 2+2?');
        });

        it('should accumulate conversation history across runs', async () => {
            const robota = new Robota(createConfig());
            await robota.run('First message');
            await robota.run('Second message');

            const history = robota.getHistory();
            // 2 user messages + 2 assistant messages = 4
            expect(history.length).toBe(4);
        });

        it('should include previous messages when calling provider', async () => {
            const provider = new TrackingProvider();
            const config = createConfig({ aiProviders: [provider] });
            const robota = new Robota(config);

            await robota.run('First');
            await robota.run('Second');

            const secondCall = provider.chatCalls[1];
            const userMessages = secondCall.messages.filter(m => m.role === 'user');
            expect(userMessages).toHaveLength(2);
            expect(userMessages[0].content).toBe('First');
            expect(userMessages[1].content).toBe('Second');
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

            expect(plugin.beforeRunCalls).toEqual(['Test input']);
            expect(plugin.afterRunCalls).toHaveLength(1);
            expect(plugin.afterRunCalls[0].input).toBe('Test input');
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
            await robota.run('test');

            const stats = robota.getStats();
            expect(stats.tools).toContain('tracking-tool');
        });

        it('should support updateTools after initialization', async () => {
            const tool1 = new TrackingTool();
            const config = createConfig({ tools: [tool1] });

            const robota = new Robota(config);
            await robota.run('init');

            const result = await robota.updateTools([new AnotherTool()]);
            expect(result.version).toBe(2);

            const stats = robota.getStats();
            expect(stats.tools).toContain('another-tool');
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
            const config = createConfig({
                aiProviders: [new TrackingProvider(), new SecondProvider()],
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
            expect(stats.historyLength).toBe(2); // 1 user + 1 assistant
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
