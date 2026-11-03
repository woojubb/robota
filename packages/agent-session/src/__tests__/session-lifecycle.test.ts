import { describe, expect, it, vi } from 'vitest';
import type {
  IAIProvider,
  IProviderCapabilities,
  IProviderRequest,
  IRawProviderResponse,
  ITerminalOutput,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import { Session } from '../session.js';

const searchCapabilities = (enabled: boolean): IProviderCapabilities => ({
  functionCalling: { supported: true },
  nativeWebTools: {
    webSearch: { supported: true, enabled, source: 'test-hosted-search' },
    webFetch: { supported: false, enabled: false },
  },
});

/**
 * A provider that supports hosted web search and starts with it off. It also exposes a runtime
 * enablement hook, found by name only (the provider contract does not declare one): a session that
 * tried to switch search on behind the provider's back would call it and flip `webSearchEnabled`.
 * Only the provider's own construction is allowed to decide that.
 */
class HostedSearchProvider implements IAIProvider {
  readonly name = 'hosted-search';
  readonly version = '1.0.0';
  webSearchEnabled = false;
  readonly configureNativeWebTools = vi.fn((request: { webSearch?: boolean }) => {
    if (request.webSearch === true) this.webSearchEnabled = true;
    return searchCapabilities(this.webSearchEnabled);
  });

  getCapabilities(): IProviderCapabilities {
    return searchCapabilities(this.webSearchEnabled);
  }

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

const terminal: ITerminalOutput = {
  write() {},
  writeLine() {},
  writeMarkdown() {},
  writeError() {},
  prompt: async () => '',
  select: async () => 0,
  spinner: () => ({ stop() {}, update() {} }),
};

describe('session provider web search ownership', () => {
  it('leaves hosted web search to the provider on creation and on a provider swap', async () => {
    const initial = new HostedSearchProvider();
    const replacement = new HostedSearchProvider();

    const session = new Session({
      cwd: process.cwd(),
      tools: [],
      provider: initial,
      systemMessage: 'Fixture',
      terminal,
      model: 'initial',
      autoCompactThreshold: false,
    });

    expect(initial.configureNativeWebTools).not.toHaveBeenCalled();
    expect(initial.getCapabilities().nativeWebTools.webSearch.enabled).toBe(false);

    session.swapProvider(replacement, 'replacement');

    expect(replacement.configureNativeWebTools).not.toHaveBeenCalled();
    expect(replacement.getCapabilities().nativeWebTools.webSearch.enabled).toBe(false);
    expect(initial.configureNativeWebTools).not.toHaveBeenCalled();

    await session.shutdown();
  });
});
