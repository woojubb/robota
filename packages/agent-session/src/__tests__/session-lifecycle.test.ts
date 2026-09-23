import { describe, expect, it, vi } from 'vitest';
import type {
  IAIProvider,
  IProviderCapabilities,
  IProviderNativeWebToolRequest,
  IProviderRequest,
  IRawProviderResponse,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import { configureProvider } from '../session-lifecycle';

import type { ISessionOptions } from '../session-types.js';

const enabledCapabilities: IProviderCapabilities = {
  functionCalling: { supported: true },
  nativeWebTools: {
    webSearch: { supported: true, enabled: true, source: 'anthropic-messages' },
    webFetch: {
      supported: false,
      enabled: false,
      reason: 'Anthropic provider exposes server web search only.',
    },
  },
};

class HookedProvider implements IAIProvider {
  readonly name = 'custom-hosted-web';
  readonly version = '1.0.0';
  readonly configureNativeWebTools = vi.fn(
    (_request: IProviderNativeWebToolRequest): IProviderCapabilities => enabledCapabilities,
  );

  async chat(): Promise<TUniversalMessage> {
    throw new Error('not used');
  }

  async generateResponse(_payload: IProviderRequest): Promise<IRawProviderResponse> {
    throw new Error('not used');
  }

  supportsTools(): boolean {
    return true;
  }

  validateConfig(): boolean {
    return true;
  }
}

describe('configureProvider', () => {
  it('uses provider-neutral native web configuration hooks', () => {
    const provider = new HookedProvider();

    // `configureProvider` does not read its options argument (`_options`), so this case supplies
    // the empty object it has always passed rather than an unrelated full session configuration.
    configureProvider(provider, {} as ISessionOptions, vi.fn());

    expect(provider.configureNativeWebTools).toHaveBeenCalledWith({ webSearch: true });
  });
});
