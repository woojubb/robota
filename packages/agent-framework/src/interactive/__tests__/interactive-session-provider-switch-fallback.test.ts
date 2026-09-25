/**
 * Switching the provider mid-session keeps the session's model fallback chain: it is read again with
 * the new profile as primary, under the same organization policy.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createNodeHostSettingsSource } from '../../config/node-host-settings-source.js';
import { FallbackProvider } from '../../routing/fallback-provider.js';
import { applyModelFallback } from '../../routing/model-fallback-chain.js';
import { InteractiveSession } from '../interactive-session.js';

import { ProviderError } from '@robota-sdk/agent-core';

import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';

function createMockSession() {
  return {
    run: vi.fn().mockResolvedValue('mock response'),
    abort: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getContextState: vi.fn().mockReturnValue({
      usedPercentage: 10,
      usedTokens: 1000,
      maxTokens: 200000,
    }),
    clearHistory: vi.fn(),
    getPermissionMode: vi.fn().mockReturnValue('default'),
    setPermissionMode: vi.fn(),
    getProviderId: vi.fn().mockReturnValue('test-provider'),
    getModelId: vi.fn().mockReturnValue('test-model'),
    getEventService: vi.fn().mockReturnValue({ subscribe: vi.fn(), unsubscribe: vi.fn() }),
    getSessionId: vi.fn().mockReturnValue('sess-1'),
    getSystemMessage: vi.fn().mockReturnValue('system prompt with capabilities'),
    getToolSchemas: vi
      .fn()
      .mockReturnValue([
        { name: 'Read', description: 'Read files', parameters: { type: 'object', properties: {} } },
      ]),
    getMessageCount: vi.fn().mockReturnValue(0),
    getSessionAllowedTools: vi.fn().mockReturnValue([]),
    compact: vi.fn(),
    injectMessage: vi.fn(),
    injectRawMessage: vi.fn(),
    syncContextFromHistory: vi.fn(),
  };
}

/** Every provider but anthropic is overloaded, so a working chain is one that reaches anthropic. */
const DEFINITIONS: IProviderDefinition[] = ['anthropic', 'openai', 'gemini'].map((type) => ({
  type,
  createProvider: (config) =>
    ({
      name: type,
      model: config.model,
      chat: async () => {
        if (type !== 'anthropic') {
          throw new ProviderError('overloaded', type, undefined, undefined, { status: 529 });
        }
        return {
          id: 'a',
          role: 'assistant',
          content: `answered by ${config.model}`,
          state: 'complete',
          timestamp: new Date(),
        };
      },
    }) as unknown as IAIProvider,
}));

const SETTINGS = {
  currentProvider: 'claude',
  providers: {
    claude: { type: 'anthropic', model: 'claude-main', apiKey: 'a' },
    openai: { type: 'openai', model: 'gpt-profile', apiKey: 'b' },
    gemini: { type: 'gemini', model: 'gemini-profile', apiKey: 'c' },
  },
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'robota-switch-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function startSession(allowedProviders?: string[], entries = ['openai', 'gemini']) {
  const path = join(dir, 'settings.json');
  writeFileSync(path, JSON.stringify(SETTINGS));
  const onFallback = vi.fn();
  const { provider } = applyModelFallback({
    provider: { name: 'anthropic' } as unknown as IAIProvider,
    entries,
    settings: SETTINGS,
    primary: { profile: 'claude', config: { name: 'anthropic', model: 'claude-main' } },
    providerDefinitions: DEFINITIONS,
    providerOptions: { onFallback },
  });
  const mockSession = { ...createMockSession(), swapProvider: vi.fn() };
  const session = new InteractiveSession({
    session: mockSession,
    cwd: '/tmp',
    provider,
    providerDefinitions: DEFINITIONS,
    userSettingsSources: [createNodeHostSettingsSource('user', path)],
    ...(allowedProviders !== undefined && { orgPolicy: { allowedProviders } }),
  } as never);
  const switchProvider = (profile: string): Promise<void> =>
    (session as unknown as { switchProvider(p: string): Promise<void> }).switchProvider(profile);
  return { session, mockSession, switchProvider, onFallback };
}

describe('/provider switch with a model fallback chain', () => {
  it('reads the chain again with the new profile as primary', async () => {
    const { mockSession, switchProvider, onFallback } = startSession();

    await switchProvider('openai');

    const [swapped, model] = mockSession.swapProvider.mock.calls[0]!;
    expect(model).toBe('gpt-profile');
    expect(swapped).toBeInstanceOf(FallbackProvider);
    // The new primary is no longer its own fallback.
    expect((swapped as FallbackProvider).chain).toEqual([
      { provider: 'gemini', model: 'gemini-profile' },
    ]);
    expect((swapped as FallbackProvider).chainOptions.onFallback).toBe(onFallback);
  });

  it('applies the organization policy to the chain it reads again, and says so', async () => {
    const { session, mockSession, switchProvider } = startSession(['claude', 'openai']);

    await switchProvider('openai');

    const [swapped] = mockSession.swapProvider.mock.calls[0]!;
    expect((swapped as FallbackProvider).chain).toEqual([]);
    expect(session.getMessages().map((message) => message.content)).toContain(
      'Fallback models not allowed by your organization policy were dropped: gemini.',
    );
  });

  it('keeps a chain whose every entry was dropped at startup, for the next primary', async () => {
    // Starting on claude, the only entry is claude itself, so nothing survives the start.
    const { mockSession, switchProvider } = startSession(undefined, ['claude']);

    await switchProvider('openai');

    const [swapped] = mockSession.swapProvider.mock.calls[0]!;
    expect((swapped as FallbackProvider).chain).toEqual([
      { provider: 'anthropic', model: 'claude-main' },
    ]);
    const reply = await (swapped as IAIProvider).chat([], { model: 'gpt-profile' });
    expect(reply.content).toBe('answered by claude-main');
  });
});
