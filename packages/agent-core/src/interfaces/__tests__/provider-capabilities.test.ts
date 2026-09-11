import { describe, expect, it } from 'vitest';
import { AbstractAIProvider } from '../../abstracts/abstract-ai-provider';
import type { TUniversalMessage } from '../messages';
import {
  assertProviderNativeWebToolsAvailable,
  getProviderCapabilities,
  type IChatOptions,
  type IAIProvider,
} from '../provider';

class TestProvider extends AbstractAIProvider {
  override readonly name = 'test';
  override readonly version = '1.0.0';

  chatOptions: IChatOptions | undefined;

  override async chat(
    _messages: TUniversalMessage[],
    options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    this.chatOptions = options;
    return {
      id: 'assistant-1',
      role: 'assistant',
      content: 'ok',
      state: 'complete',
      timestamp: new Date('2026-05-04T00:00:00.000Z'),
    };
  }

  override async *chatStream(
    _messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    this.chatOptions = options;
    yield {
      id: 'assistant-stream-1',
      role: 'assistant',
      content: 'ok',
      state: 'complete',
      timestamp: new Date('2026-05-04T00:00:00.000Z'),
    };
  }

  override supportsTools(): boolean {
    return true;
  }
}

describe('provider capabilities', () => {
  it('reports safe default capabilities for providers without native web tools', () => {
    const provider = new TestProvider();

    expect(getProviderCapabilities(provider)).toEqual({
      functionCalling: { supported: true },
      nativeWebTools: {
        webSearch: {
          supported: false,
          enabled: false,
          reason: 'Provider does not declare native web search support.',
        },
        webFetch: {
          supported: false,
          enabled: false,
          reason: 'Provider does not declare native web fetch support.',
        },
      },
    });
  });

  it('threads generic raw-request effort selection and resolution into the adapter chat call', async () => {
    const provider = new TestProvider();
    const onModelEffortOutcome = () => undefined;
    const effortResolution = {
      selection: 'auto' as const,
      effective: 'low' as const,
      disposition: 'model-default' as const,
      fingerprint: 'test|auto|low|model-default|native|2026-09-11',
    };

    await provider.generateResponse({
      messages: [],
      model: 'test-model',
      effort: 'auto',
      effortResolution,
      onModelEffortOutcome,
    });

    expect(provider.chatOptions).toMatchObject({
      effort: 'auto',
      effortResolution,
      onModelEffortOutcome: expect.any(Function),
    });
  });

  it('resolves a generic no-table request to not-applied and observes it exactly once', async () => {
    const provider = new TestProvider();
    const outcomes: unknown[] = [];

    const response = await provider.generateResponse({
      messages: [],
      model: 'test-model',
      effort: 'high',
      onModelEffortOutcome: (outcome) => outcomes.push(outcome),
    });

    expect(provider.chatOptions).toMatchObject({
      effort: 'high',
      effortResolution: expect.objectContaining({
        effective: null,
        disposition: 'not-applied',
      }),
    });
    expect(outcomes).toEqual([
      expect.objectContaining({
        resolution: expect.objectContaining({ effective: null, disposition: 'not-applied' }),
        nativeControl: { state: 'omitted', reason: 'model-effort-not-applied' },
        providerDispatch: { state: 'sent' },
      }),
    ]);
    expect(response.modelEffortOutcome).toEqual(
      expect.objectContaining({
        resolution: expect.objectContaining({ effective: null, disposition: 'not-applied' }),
        nativeControl: { state: 'omitted', reason: 'model-effort-not-applied' },
        providerDispatch: { state: 'sent' },
      }),
    );
  });

  it('adds one explicit terminal raw envelope after generic streamed messages', async () => {
    const provider = new TestProvider();
    const responses = [];

    for await (const response of provider.generateStreamingResponse({
      messages: [],
      model: 'test-model',
      effort: 'high',
    })) {
      responses.push(response);
    }

    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({ content: 'ok' });
    expect(responses[1]).toEqual({
      content: null,
      model: 'test-model',
      metadata: undefined,
      modelEffortOutcome: expect.objectContaining({
        resolution: expect.objectContaining({ selection: 'high', disposition: 'not-applied' }),
      }),
    });
  });

  it('reports no function calling when legacy provider mocks omit supportsTools', () => {
    const provider = {
      name: 'legacy-mock',
      version: '1.0.0',
      chat: async () => ({
        id: 'assistant-1',
        role: 'assistant',
        content: 'ok',
        state: 'complete',
        timestamp: new Date('2026-05-04T00:00:00.000Z'),
      }),
      generateResponse: async () => ({ content: 'ok' }),
      validateConfig: () => true,
    } as unknown as IAIProvider;

    expect(getProviderCapabilities(provider).functionCalling).toEqual({ supported: false });
  });

  it('rejects requested native web tools when provider support is absent', () => {
    const provider = new TestProvider();
    const capabilities = getProviderCapabilities(provider);

    expect(() =>
      assertProviderNativeWebToolsAvailable('test', capabilities, { webSearch: true }),
    ).toThrow(
      'Provider test does not support native web search. Provider does not declare native web search support.',
    );
  });

  it('rejects requested native web tools when support exists but is disabled', () => {
    expect(() =>
      assertProviderNativeWebToolsAvailable(
        'qwen',
        {
          functionCalling: { supported: true },
          nativeWebTools: {
            webSearch: {
              supported: true,
              enabled: false,
              source: 'qwen-responses',
              reason: 'Enable builtInWebTools.webSearch or builtInWebTools.webFetch.',
            },
            webFetch: {
              supported: true,
              enabled: true,
              source: 'qwen-responses',
            },
          },
        },
        { webSearch: true },
      ),
    ).toThrow(
      'Provider qwen supports native web search but it is not enabled. Enable builtInWebTools.webSearch or builtInWebTools.webFetch.',
    );
  });
});
