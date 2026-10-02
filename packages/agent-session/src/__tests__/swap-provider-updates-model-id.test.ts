/**
 * #3282 §2 — `swapProvider` must update `this.model` so `getModelId()` (and therefore
 * `session_status`'s `model` field, and the GUI's model chip) reflects the NEW provider's model
 * right after a hot-swap, not the previous provider's.
 *
 * Before this change, `swapProvider` called `this.agent.swapDefaultProvider(newProvider, model)` —
 * which updates the AGENT's own config — but never touched `Session`'s own `this.model` cache, which
 * is what `getModelId()` actually reads. A `/provider switch` (or `/model` switching to another
 * profile) left the reported model stale until something else (`applyModelOptions`) happened to
 * touch it.
 */

import { describe, it, expect, vi } from 'vitest';
import { Session } from '../session.js';

const swapDefaultProviderSpy = vi.fn();

vi.mock('@robota-sdk/agent-core', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-core');
  return {
    ...actual,
    ConversationAgent: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue('mock response'),
      getHistory: vi.fn().mockReturnValue([]),
      clearHistory: vi.fn(),
      injectMessage: vi.fn(),
      getFullHistory: vi.fn().mockReturnValue([]),
      addHistoryEntry: vi.fn(),
      ensureReady: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn(),
      swapDefaultProvider: swapDefaultProviderSpy,
    })),
  };
});

const MOCK_PROVIDER = {
  name: 'anthropic',
  version: '1.0.0',
  chat: vi.fn().mockResolvedValue({ role: 'assistant', content: 'mock', timestamp: new Date() }),
  supportsTools: () => true,
  validateConfig: () => true,
};

const MOCK_TERMINAL = {
  write: vi.fn(),
  writeLine: vi.fn(),
  writeMarkdown: vi.fn(),
  writeError: vi.fn(),
  prompt: vi.fn(),
  select: vi.fn(),
  spinner: () => ({ stop: vi.fn(), update: vi.fn() }),
};

function buildSession(): Session {
  return new Session({
    cwd: process.cwd(),
    tools: [],
    provider: MOCK_PROVIDER as never,
    systemMessage: 'test',
    terminal: MOCK_TERMINAL as never,
    model: 'claude-sonnet-4-6',
  });
}

describe('Session.swapProvider updates getModelId() (#3282 §2)', () => {
  it('reports the new model right after swapping providers', () => {
    swapDefaultProviderSpy.mockClear();
    const session = buildSession();
    expect(session.getModelId()).toBe('claude-sonnet-4-6');

    const nextProvider = {
      name: 'openai',
      version: '1.0.0',
      chat: vi.fn(),
      supportsTools: () => true,
      validateConfig: () => true,
    };
    session.swapProvider(nextProvider as never, 'gpt-5.1');

    expect(session.getModelId()).toBe('gpt-5.1');
    expect(swapDefaultProviderSpy).toHaveBeenCalledWith(nextProvider, 'gpt-5.1');
  });
});
