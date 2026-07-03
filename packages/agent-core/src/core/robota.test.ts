import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { Robota } from './robota';
import type { IAgentConfig, IRunOptions } from '../interfaces/agent';
import { AbstractAIProvider } from '../abstracts/abstract-ai-provider';
import { AbstractPlugin } from '../abstracts/abstract-plugin';
import { AbstractTool } from '../abstracts/abstract-tool';
import type { IToolSchema, IChatOptions } from '../interfaces/provider';
import type { IToolExecutionContext, IToolResult, TToolParameters } from '../interfaces/tool';
import type { TUniversalMessage } from '../interfaces/messages';
import { ConfigurationError, StructuredOutputError } from '../utils/errors';

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
      id: 'test-id',
      role: 'assistant',
      content: `Response to: ${messages[messages.length - 1]?.content ?? ''}`,
      state: 'complete' as const,
      timestamp: new Date(),
    };
  }

  override async *chatStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    this.chatCalls.push({ messages, options });
    yield {
      id: 'test-id',
      role: 'assistant',
      content: 'Streamed chunk 1',
      state: 'complete' as const,
      timestamp: new Date(),
    };
    yield {
      id: 'test-id-2',
      role: 'assistant',
      content: 'Streamed chunk 2',
      state: 'complete' as const,
      timestamp: new Date(),
    };
  }
}

// A second provider with a different name
class SecondProvider extends AbstractAIProvider {
  readonly name = 'provider-2';
  readonly version = '1.0.0';

  async chat(messages: TUniversalMessage[]): Promise<TUniversalMessage> {
    return {
      id: 'test-id',
      role: 'assistant',
      content: `Provider-2: ${messages[messages.length - 1]?.content ?? ''}`,
      state: 'complete' as const,
      timestamp: new Date(),
    };
  }

  override async *chatStream(): AsyncIterable<TUniversalMessage> {
    yield {
      id: 'test-id',
      role: 'assistant',
      content: 'chunk',
      state: 'complete' as const,
      timestamp: new Date(),
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
          query: { type: 'string' as const },
        },
      },
    };
  }

  protected override async executeImpl(
    parameters: TToolParameters,
    _context: IToolExecutionContext,
  ): Promise<IToolResult> {
    this.executionCount++;
    const query = typeof parameters.query === 'string' ? parameters.query : '';
    return {
      success: true,
      data: `Tool result for: ${query}`,
    };
  }
}

// A second tool with a different name
class AnotherTool extends AbstractTool {
  override get schema(): IToolSchema {
    return {
      name: 'another-tool',
      description: 'Another tool',
      parameters: { type: 'object' as const, properties: {} },
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
      temperature: 0.5,
    },
    logging: { level: 'silent', enabled: false },
    ...overrides,
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
        systemMessage: 'You are a helpful assistant.',
      });

      const robota = new Robota(config);
      await robota.run('Hello');

      expect(provider.chatCalls).toHaveLength(1);
      const messages = provider.chatCalls[0].messages;
      const systemMsg = messages.find((m) => m.role === 'system');
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
      const userMessages = secondCall.messages.filter((m) => m.role === 'user');
      expect(userMessages).toHaveLength(2);
      expect(userMessages[0].content).toBe('First');
      expect(userMessages[1].content).toBe('Second');
    });

    it('should emit replay-grade provider and history mutation events', async () => {
      const provider = new TrackingProvider();
      const config = createConfig({ aiProviders: [provider] });
      const robota = new Robota(config);
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];

      await robota.run('Replay this', {
        onExecutionEvent: (event, data) => {
          events.push({ event, data });
        },
      });

      expect(events.map((entry) => entry.event)).toEqual(
        expect.arrayContaining([
          'provider_request',
          'provider_response_raw',
          'provider_response_normalized',
          'assistant_message_committed',
          'history_mutation',
        ]),
      );

      const rawEvent = events.find((entry) => entry.event === 'provider_response_raw');
      expect(rawEvent?.data).toEqual(
        expect.objectContaining({
          executionId: expect.any(String),
          round: 1,
          response: expect.objectContaining({ role: 'assistant' }),
        }),
      );

      const mutations = events.filter((entry) => entry.event === 'history_mutation');
      expect(mutations.map((entry) => entry.data)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            mutation: 'append_message',
            message: expect.objectContaining({ role: 'user', content: 'Replay this' }),
          }),
          expect.objectContaining({
            mutation: 'append_message',
            message: expect.objectContaining({ role: 'assistant' }),
          }),
        ]),
      );
    });

    it('should route provider-native raw payload callbacks into execution events', async () => {
      class NativePayloadProvider extends TrackingProvider {
        override async chat(
          messages: TUniversalMessage[],
          options?: IChatOptions,
        ): Promise<TUniversalMessage> {
          options?.onProviderNativeRawPayload?.({
            provider: this.name,
            apiSurface: 'test-surface',
            payloadKind: 'response',
            payload: { id: 'native-response-1', choices: [{ index: 0 }] },
          });
          return super.chat(messages, options);
        }
      }

      const provider = new NativePayloadProvider();
      const config = createConfig({ aiProviders: [provider] });
      const robota = new Robota(config);
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];

      await robota.run('Native replay', {
        onExecutionEvent: (event, data) => {
          events.push({ event, data });
        },
      });

      const nativeEvent = events.find((entry) => entry.event === 'provider_native_raw_payload');
      expect(nativeEvent?.data).toEqual(
        expect.objectContaining({
          executionId: expect.any(String),
          round: 1,
          provider: 'tracking-provider',
          apiSurface: 'test-surface',
          payloadKind: 'response',
          sequence: 0,
          payload: { id: 'native-response-1', choices: [{ index: 0 }] },
        }),
      );
    });

    it('should emit provider stream raw delta events when provider text deltas arrive', async () => {
      class DeltaProvider extends TrackingProvider {
        override async chat(
          messages: TUniversalMessage[],
          options?: IChatOptions,
        ): Promise<TUniversalMessage> {
          options?.onTextDelta?.('alpha');
          options?.onTextDelta?.('beta');
          return super.chat(messages, options);
        }
      }

      const provider = new DeltaProvider();
      const config = createConfig({ aiProviders: [provider] });
      const robota = new Robota(config);
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];

      await robota.run('Stream replay', {
        onTextDelta: vi.fn(),
        onExecutionEvent: (event, data) => {
          events.push({ event, data });
        },
      });

      const streamDeltas = events.filter((entry) => entry.event === 'provider_stream_raw_delta');
      expect(streamDeltas.map((entry) => entry.data.delta)).toEqual(['alpha', 'beta']);
      expect(streamDeltas.map((entry) => entry.data.sequence)).toEqual([0, 1]);
    });
  });

  // ----------------------------------------------------------------
  // Run concurrency contract (CORE-012)
  // ----------------------------------------------------------------
  describe('run concurrency', () => {
    it('should serialize concurrent run() calls into strictly sequential history', async () => {
      class SlowProvider extends TrackingProvider {
        override async chat(
          messages: TUniversalMessage[],
          options?: IChatOptions,
        ): Promise<TUniversalMessage> {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return super.chat(messages, options);
        }
      }
      const provider = new SlowProvider();
      const robota = new Robota(createConfig({ aiProviders: [provider] }));

      const [first, second] = await Promise.all([
        robota.run('First concurrent'),
        robota.run('Second concurrent'),
      ]);

      expect(first).toBe('Response to: First concurrent');
      expect(second).toBe('Response to: Second concurrent');

      const history = robota.getHistory();
      expect(history.map((message) => ({ role: message.role, content: message.content }))).toEqual([
        { role: 'user', content: 'First concurrent' },
        { role: 'assistant', content: 'Response to: First concurrent' },
        { role: 'user', content: 'Second concurrent' },
        { role: 'assistant', content: 'Response to: Second concurrent' },
      ]);

      // The queued run must see the completed first exchange, not a partial one.
      const secondCall = provider.chatCalls[1];
      expect(
        secondCall.messages.some(
          (message) =>
            message.role === 'assistant' && message.content === 'Response to: First concurrent',
        ),
      ).toBe(true);
    });

    it('should reject a queued run whose signal aborts while waiting', async () => {
      let releaseFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      class GatedProvider extends TrackingProvider {
        override async chat(
          messages: TUniversalMessage[],
          options?: IChatOptions,
        ): Promise<TUniversalMessage> {
          await firstGate;
          return super.chat(messages, options);
        }
      }
      const provider = new GatedProvider();
      const robota = new Robota(createConfig({ aiProviders: [provider] }));

      const firstRun = robota.run('Holds the slot');
      const controller = new AbortController();
      const queuedRun = robota.run('Aborted while queued', { signal: controller.signal });
      const queuedFailure = expect(queuedRun).rejects.toThrow('Run aborted while queued');

      controller.abort();
      releaseFirst();

      await expect(firstRun).resolves.toBe('Response to: Holds the slot');
      await queuedFailure;
      // The aborted run must never reach the provider.
      expect(provider.chatCalls).toHaveLength(1);
    });

    it('should hold the run slot until runStream is fully consumed', async () => {
      const provider = new TrackingProvider();
      const robota = new Robota(createConfig({ aiProviders: [provider] }));

      const iterator = robota.runStream('Stream first')[Symbol.asyncIterator]();
      await iterator.next(); // stream is now mid-consumption and owns the slot

      let queuedCompleted = false;
      const queuedRun = robota.run('Queued behind stream').then((response) => {
        queuedCompleted = true;
        return response;
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(queuedCompleted).toBe(false);
      expect(provider.chatCalls).toHaveLength(1);

      // Drain the stream — completion releases the slot to the queued run.
      let next = await iterator.next();
      while (!next.done) {
        next = await iterator.next();
      }

      await expect(queuedRun).resolves.toBe('Response to: Queued behind stream');
    });
  });

  // ----------------------------------------------------------------
  // Model option threading (CORE-016)
  // ----------------------------------------------------------------
  describe('maxTokens/temperature threading', () => {
    it('run(): defaultModel.maxTokens reaches the provider request', async () => {
      const provider = new TrackingProvider();
      const robota = new Robota(
        createConfig({
          aiProviders: [provider],
          defaultModel: {
            provider: 'tracking-provider',
            model: 'test-model',
            temperature: 0.5,
            maxTokens: 50,
          },
        }),
      );

      await robota.run('hello');

      expect(provider.chatCalls[0].options?.maxTokens).toBe(50);
      expect(provider.chatCalls[0].options?.temperature).toBe(0.5);
    });

    it('run(): per-run maxTokens/temperature override defaultModel', async () => {
      const provider = new TrackingProvider();
      const robota = new Robota(createConfig({ aiProviders: [provider] }));

      await robota.run('hello', { maxTokens: 25, temperature: 0.9 });

      expect(provider.chatCalls[0].options?.maxTokens).toBe(25);
      expect(provider.chatCalls[0].options?.temperature).toBe(0.9);
    });

    it('runStream(): defaultModel.maxTokens/temperature reach the provider request', async () => {
      const provider = new TrackingProvider();
      const robota = new Robota(
        createConfig({
          aiProviders: [provider],
          defaultModel: {
            provider: 'tracking-provider',
            model: 'test-model',
            temperature: 0.5,
            maxTokens: 50,
          },
        }),
      );

      for await (const _chunk of robota.runStream('hello')) {
        // consume
      }

      expect(provider.chatCalls[0].options?.maxTokens).toBe(50);
      expect(provider.chatCalls[0].options?.temperature).toBe(0.5);
    });

    it('runStream(): per-run maxTokens/temperature override defaultModel', async () => {
      const provider = new TrackingProvider();
      const robota = new Robota(createConfig({ aiProviders: [provider] }));

      for await (const _chunk of robota.runStream('hello', {
        maxTokens: 25,
        temperature: 0.9,
      })) {
        // consume
      }

      expect(provider.chatCalls[0].options?.maxTokens).toBe(25);
      expect(provider.chatCalls[0].options?.temperature).toBe(0.9);
    });
  });

  // ----------------------------------------------------------------
  // Run-isolated (stateless) mode (CORE-014)
  // ----------------------------------------------------------------
  describe('retainHistory: false', () => {
    it('sends only system + current prompt on every consecutive run (no accumulation)', async () => {
      const provider = new TrackingProvider();
      const robota = new Robota(
        createConfig({
          aiProviders: [provider],
          systemMessage: 'You are terse.',
          retainHistory: false,
        }),
      );

      await robota.run('First');
      await robota.run('Second');
      await robota.run('Third');

      expect(provider.chatCalls).toHaveLength(3);
      for (const [index, call] of provider.chatCalls.entries()) {
        const roles = call.messages.map((m) => m.role);
        expect(roles).toEqual(['system', 'user']);
        expect(call.messages[1].content).toBe(['First', 'Second', 'Third'][index]);
      }
      // Nothing accumulates on the instance either.
      expect(robota.getHistory()).toEqual([]);
    });

    it('keeps the default accumulating behavior when retainHistory is unset', async () => {
      const provider = new TrackingProvider();
      const robota = new Robota(createConfig({ aiProviders: [provider] }));

      await robota.run('First');
      await robota.run('Second');

      const secondCall = provider.chatCalls[1];
      expect(secondCall.messages.filter((m) => m.role === 'user')).toHaveLength(2);
      expect(robota.getHistory()).toHaveLength(4);
    });

    it('a pre-run injected message is visible to that run and reset afterwards', async () => {
      const provider = new TrackingProvider();
      const robota = new Robota(createConfig({ aiProviders: [provider], retainHistory: false }));

      robota.injectMessage('user', 'Context: order #42 is delayed.');
      await robota.run('Summarize the context.');

      const call = provider.chatCalls[0];
      expect(call.messages.some((m) => String(m.content).includes('order #42'))).toBe(true);
      expect(robota.getHistory()).toEqual([]);

      // Next run starts clean — the injected context does not leak forward.
      await robota.run('What do you know?');
      const roles = provider.chatCalls[1].messages.map((m) => m.role);
      expect(roles.filter((r) => r === 'user')).toHaveLength(1);
    });
  });

  // ----------------------------------------------------------------
  // Structured output (CORE-015)
  // ----------------------------------------------------------------
  describe('structured output', () => {
    // Provider that returns scripted response texts in order, recording chat options.
    class ScriptedTextProvider extends TrackingProvider {
      constructor(private readonly responses: string[]) {
        super();
      }

      override async chat(
        messages: TUniversalMessage[],
        options?: IChatOptions,
      ): Promise<TUniversalMessage> {
        this.chatCalls.push({ messages, options });
        const content = this.responses[this.chatCalls.length - 1];
        if (content === undefined) {
          throw new Error('ScriptedTextProvider ran out of scripted responses');
        }
        return {
          id: `scripted-${this.chatCalls.length}`,
          role: 'assistant',
          content,
          state: 'complete' as const,
          timestamp: new Date(),
        };
      }
    }

    const reportSchema = z.object({ title: z.string(), score: z.number() });

    it('returns the validated typed object and forwards json_schema to the provider', async () => {
      const provider = new ScriptedTextProvider(['{"title": "ok", "score": 42}']);
      const robota = new Robota(createConfig({ aiProviders: [provider] }));

      const report = await robota.run('Give me a report.', { output: reportSchema });

      expect(report).toEqual({ title: 'ok', score: 42 });
      const chatOptions = provider.chatCalls[0].options;
      expect(chatOptions?.responseFormat).toEqual(expect.objectContaining({ type: 'json_schema' }));
    });

    it('retries with validation feedback and succeeds on the second attempt', async () => {
      const provider = new ScriptedTextProvider([
        '{"title": "missing score"}',
        '{"title": "ok", "score": 7}',
      ]);
      const robota = new Robota(createConfig({ aiProviders: [provider] }));

      const report = await robota.run('Give me a report.', { output: reportSchema });

      expect(report).toEqual({ title: 'ok', score: 7 });
      expect(provider.chatCalls).toHaveLength(2);
      // The retry turn feeds the validation issues back to the model.
      const retryMessages = provider.chatCalls[1].messages;
      const retryInput = retryMessages[retryMessages.length - 1];
      expect(String(retryInput.content)).toContain('did not match the required JSON schema');
      expect(String(retryInput.content)).toContain('score');
    });

    it('throws StructuredOutputError when the retry budget is exhausted', async () => {
      const provider = new ScriptedTextProvider(['not json', 'still not json']);
      const robota = new Robota(createConfig({ aiProviders: [provider] }));

      await expect(
        robota.run('Give me a report.', { output: reportSchema, outputRetries: 1 }),
      ).rejects.toThrow(StructuredOutputError);
      expect(provider.chatCalls).toHaveLength(2);
    });

    it('accepts an explicit JSON-schema wrapper', async () => {
      const provider = new ScriptedTextProvider(['{"answer": "yes"}']);
      const robota = new Robota(createConfig({ aiProviders: [provider] }));

      const result = await robota.run('Answer.', {
        output: {
          jsonSchema: {
            type: 'object',
            properties: { answer: { type: 'string' } },
            required: ['answer'],
          },
          name: 'answer_schema',
        },
      });

      expect(result).toEqual({ answer: 'yes' });
    });

    it('returns the validated object as the runStream generator return value', async () => {
      class ScriptedStreamProvider extends TrackingProvider {
        override async *chatStream(
          messages: TUniversalMessage[],
          options?: IChatOptions,
        ): AsyncIterable<TUniversalMessage> {
          this.chatCalls.push({ messages, options });
          yield {
            id: 'chunk-1',
            role: 'assistant',
            content: '{"title": "streamed",',
            state: 'complete' as const,
            timestamp: new Date(),
          };
          yield {
            id: 'chunk-2',
            role: 'assistant',
            content: ' "score": 3}',
            state: 'complete' as const,
            timestamp: new Date(),
          };
        }
      }
      const provider = new ScriptedStreamProvider();
      const robota = new Robota(createConfig({ aiProviders: [provider] }));

      const stream = robota.runStream('Give me a report.', { output: reportSchema });
      const iterator = stream[Symbol.asyncIterator]();
      const chunks: string[] = [];
      let next = await iterator.next();
      while (!next.done) {
        chunks.push(next.value);
        next = await iterator.next();
      }

      expect(chunks.join('')).toBe('{"title": "streamed", "score": 3}');
      expect(next.value).toEqual({ title: 'streamed', score: 3 });
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
          model: 'model-a',
        },
      });

      const robota = new Robota(config);
      await robota.run('init');

      robota.setModel({
        provider: 'provider-2',
        model: 'model-b',
        temperature: 0.9,
      });

      const model = robota.getModel();
      expect(model.provider).toBe('provider-2');
      expect(model.model).toBe('model-b');
      expect(model.temperature).toBe(0.9);
    });

    it('should reject setModel with unknown provider', async () => {
      const robota = new Robota(createConfig());
      await robota.run('init');

      expect(() =>
        robota.setModel({
          provider: 'nonexistent',
          model: 'x',
        }),
      ).toThrow(ConfigurationError);
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

      const result = await robota.destroy();
      expect(result.errors).toEqual([]);
    });

    it('should be safe to call destroy before any run', async () => {
      const robota = new Robota(createConfig());
      await expect(robota.destroy()).resolves.toEqual({ errors: [] });
    });

    it('resolves with collected errors when a cleanup step fails (best-effort, CORE-013)', async () => {
      class FailingCleanupPlugin extends AbstractPlugin {
        override readonly name = 'failing-cleanup-plugin';
        override readonly version = '1.0.0';
        override async unsubscribeFromModuleEvents(): Promise<void> {
          throw new Error('cleanup boom');
        }
      }
      class HealthyCleanupPlugin extends AbstractPlugin {
        override readonly name = 'healthy-cleanup-plugin';
        override readonly version = '1.0.0';
        unsubscribed = false;
        override async unsubscribeFromModuleEvents(): Promise<void> {
          this.unsubscribed = true;
        }
      }
      const healthy = new HealthyCleanupPlugin();
      const robota = new Robota(createConfig({ plugins: [new FailingCleanupPlugin(), healthy] }));
      await robota.run('test');

      // Never rejects — safe to fire-and-forget; the failure comes back in the result.
      const result = await robota.destroy();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('cleanup boom');
      // Remaining cleanup steps still ran (no early abort of the disposal sequence).
      expect(healthy.unsubscribed).toBe(true);
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

  // ----------------------------------------------------------------
  // injectMessage
  // ----------------------------------------------------------------
  describe('injectMessage', () => {
    it('should inject assistant message into history without running', () => {
      const robota = new Robota(createConfig());
      robota.injectMessage('assistant', 'injected summary');

      const history = robota.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].role).toBe('assistant');
      expect(history[0].content).toBe('injected summary');
    });

    it('should inject system message into history', () => {
      const robota = new Robota(createConfig());
      robota.injectMessage('system', 'system context');

      const history = robota.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].role).toBe('system');
    });

    it('should inject user message into history', () => {
      const robota = new Robota(createConfig());
      robota.injectMessage('user', 'user question');

      const history = robota.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].role).toBe('user');
    });

    it('injected message is visible to subsequent run()', async () => {
      const provider = new TrackingProvider();
      const robota = new Robota(createConfig({ aiProviders: [provider] }));

      robota.injectMessage('assistant', '[Context Summary] previous conversation');
      await robota.run('continue');

      // Provider should receive the injected message + user message
      const lastCall = provider.chatCalls[provider.chatCalls.length - 1];
      const messages = lastCall?.messages ?? [];
      expect(messages.some((m) => m.content === '[Context Summary] previous conversation')).toBe(
        true,
      );
      expect(messages.some((m) => m.content === 'continue')).toBe(true);
    });
  });
});
