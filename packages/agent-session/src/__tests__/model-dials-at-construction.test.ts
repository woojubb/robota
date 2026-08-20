/**
 * ARCH-040 Group E — the model group reaches the agent at CONSTRUCTION, not only mid-session.
 *
 * `applyModelOptions` has always propagated `temperature` and `maxOutputTokens` to the agent on a
 * live session (see `apply-model-options.test.ts`). Startup propagated NEITHER, so one session held
 * two answers for the same preset depending on WHEN it was chosen — exactly what `effort` did before
 * ARCH-013 stage 1 fixed it.
 *
 * These assert on the agent CONFIG the session builds, because that is the hop that was missing. A
 * check on the session options would pass while the value stopped at the boundary.
 */

import { describe, it, expect, vi } from 'vitest';

import { Session } from '../session.js';

const constructorSpy = vi.fn();

vi.mock('@robota-sdk/agent-core', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-core');
  return {
    ...actual,
    Robota: vi.fn().mockImplementation((config: unknown) => {
      constructorSpy(config);
      return {
        run: vi.fn().mockResolvedValue('mock response'),
        getHistory: vi.fn().mockReturnValue([]),
        clearHistory: vi.fn(),
        injectMessage: vi.fn(),
        getFullHistory: vi.fn().mockReturnValue([]),
        addHistoryEntry: vi.fn(),
        ensureReady: vi.fn().mockResolvedValue(undefined),
        setModel: vi.fn(),
      };
    }),
  };
});

const MOCK_PROVIDER = {
  name: 'mock-provider',
  version: '1.0.0',
  chat: vi.fn(),
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

function defaultModelOf(extra: Record<string, unknown>): Record<string, unknown> {
  constructorSpy.mockClear();
  new Session({
    cwd: process.cwd(),
    tools: [],
    provider: MOCK_PROVIDER as never,
    systemMessage: 'test',
    terminal: MOCK_TERMINAL as never,
    model: 'base-model',
    ...extra,
  } as never);
  const config = constructorSpy.mock.calls[0]?.[0] as { defaultModel: Record<string, unknown> };
  return config.defaultModel;
}

describe('the model group reaches the agent config at construction (ARCH-040)', () => {
  it('carries `temperature` onto the agent’s default model', () => {
    expect(defaultModelOf({ temperature: 0.2 })).toMatchObject({ temperature: 0.2 });
  });

  it('maps `maxOutputTokens` onto the agent’s `maxTokens` channel', () => {
    // The SAME channel `applyModelOptions` writes. Two names for one dial would put the startup and
    // mid-session answers on different fields, which is the divergence with extra steps.
    expect(defaultModelOf({ maxOutputTokens: 4096 })).toMatchObject({ maxTokens: 4096 });
  });

  it('omits both when the session names neither, rather than sending undefined', () => {
    // An explicit `undefined` is a value the provider request builder would carry; an absent key is
    // not. The distinction is why these are conditional spreads and not plain assignments.
    const defaultModel = defaultModelOf({});
    expect('temperature' in defaultModel).toBe(false);
    expect('maxTokens' in defaultModel).toBe(false);
  });
});
