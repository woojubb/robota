/**
 * Tests for the PRESET-013 live model/effort re-application seam on Session.
 *
 * SessionBase.applyModelOptions propagates model/effort/temperature/maxOutputTokens to the agent
 * via robota.setModel and updates this.model so getModelId() stays accurate. The preset
 * maxOutputTokens field maps to the agent's maxTokens channel.
 */

import { describe, it, expect, vi } from 'vitest';
import { Session } from '../session.js';

const setModelSpy = vi.fn();

vi.mock('@robota-sdk/agent-core', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-core');
  return {
    ...actual,
    Robota: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue('mock response'),
      getHistory: vi.fn().mockReturnValue([]),
      clearHistory: vi.fn(),
      injectMessage: vi.fn(),
      getFullHistory: vi.fn().mockReturnValue([]),
      addHistoryEntry: vi.fn(),
      setModel: setModelSpy,
    })),
  };
});

const MOCK_PROVIDER = {
  name: 'mock-provider',
  version: '1.0.0',
  chat: vi.fn().mockResolvedValue({
    role: 'assistant',
    content: 'mock',
    timestamp: new Date(),
  }),
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
    tools: [],
    provider: MOCK_PROVIDER as never,
    systemMessage: 'test',
    terminal: MOCK_TERMINAL as never,
    model: 'base-model',
  });
}

describe('SessionBase.applyModelOptions (PRESET-013)', () => {
  it('TC-02: applyModelOptions({ effort }) calls robota.setModel with the effort', () => {
    setModelSpy.mockClear();
    const session = buildSession();

    session.applyModelOptions({ effort: 'medium' });

    expect(setModelSpy).toHaveBeenCalledTimes(1);
    expect(setModelSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'mock-provider',
        model: 'base-model',
        effort: 'medium',
      }),
    );
  });

  it('TC-03: applyModelOptions({ model }) updates getModelId()', () => {
    setModelSpy.mockClear();
    const session = buildSession();

    session.applyModelOptions({ model: 'new-model' });

    expect(session.getModelId()).toBe('new-model');
    expect(setModelSpy).toHaveBeenCalledWith(expect.objectContaining({ model: 'new-model' }));
  });

  it('maps maxOutputTokens to the agent maxTokens channel', () => {
    setModelSpy.mockClear();
    const session = buildSession();

    session.applyModelOptions({ maxOutputTokens: 2048, temperature: 0.5 });

    expect(setModelSpy).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 2048, temperature: 0.5 }),
    );
  });
});
