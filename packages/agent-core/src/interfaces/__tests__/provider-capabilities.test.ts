import { describe, expect, it } from 'vitest';
import { AbstractAIProvider } from '../../abstracts/abstract-ai-provider';
import type { TUniversalMessage } from '../messages';
import {
  assertProviderNativeWebToolsAvailable,
  getProviderCapabilities,
  type IAIProvider,
} from '../provider';

class TestProvider extends AbstractAIProvider {
  override readonly name = 'test';
  override readonly version = '1.0.0';

  override async chat(): Promise<TUniversalMessage> {
    return {
      id: 'assistant-1',
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
