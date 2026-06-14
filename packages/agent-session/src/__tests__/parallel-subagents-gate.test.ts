/**
 * Tests for the PRESET-016 parallel-subagents runtime gate on Session.
 *
 * The flag is pure runtime state: it is initialized from
 * ISessionOptions.enableParallelSubagents (default true = current behavior) and can be mutated via
 * setParallelSubagentsEnabled without re-applying any other preset options. The agent-tool dispatch
 * gate consults this flag at dispatch time (covered in agent-framework tests).
 */

import { describe, it, expect, vi } from 'vitest';
import { Session } from '../session.js';

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

describe('Session parallel-subagents gate (PRESET-016)', () => {
  it('TC-01: initializes parallelSubagentsEnabled from options; defaults to true', () => {
    const disabled = new Session({
      tools: [],
      provider: MOCK_PROVIDER as never,
      systemMessage: 'test',
      terminal: MOCK_TERMINAL as never,
      enableParallelSubagents: false,
    });
    expect(disabled.getParallelSubagentsEnabled()).toBe(false);

    const defaulted = new Session({
      tools: [],
      provider: MOCK_PROVIDER as never,
      systemMessage: 'test',
      terminal: MOCK_TERMINAL as never,
    });
    expect(defaulted.getParallelSubagentsEnabled()).toBe(true);
  });

  it('TC-02: setParallelSubagentsEnabled(false) flips the live flag', () => {
    const session = new Session({
      tools: [],
      provider: MOCK_PROVIDER as never,
      systemMessage: 'test',
      terminal: MOCK_TERMINAL as never,
    });

    expect(session.getParallelSubagentsEnabled()).toBe(true);
    session.setParallelSubagentsEnabled(false);
    expect(session.getParallelSubagentsEnabled()).toBe(false);
    session.setParallelSubagentsEnabled(true);
    expect(session.getParallelSubagentsEnabled()).toBe(true);
  });
});
