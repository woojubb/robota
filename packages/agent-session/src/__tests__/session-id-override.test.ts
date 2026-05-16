/**
 * Tests that Session supports optional sessionId override for resume scenarios.
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

describe('Session sessionId override', () => {
  it('generates a unique session ID by default', () => {
    const session = new Session({
      tools: [],
      provider: MOCK_PROVIDER as never,
      systemMessage: 'test',
      terminal: MOCK_TERMINAL as never,
    });

    expect(session.getSessionId()).toMatch(/^session_\d+_/);
  });

  it('uses provided sessionId when specified', () => {
    const session = new Session({
      tools: [],
      provider: MOCK_PROVIDER as never,
      systemMessage: 'test',
      terminal: MOCK_TERMINAL as never,
      sessionId: 'my-custom-session-id',
    });

    expect(session.getSessionId()).toBe('my-custom-session-id');
  });

  it('generates a new ID when sessionId is undefined', () => {
    const session = new Session({
      tools: [],
      provider: MOCK_PROVIDER as never,
      systemMessage: 'test',
      terminal: MOCK_TERMINAL as never,
      sessionId: undefined,
    });

    expect(session.getSessionId()).toMatch(/^session_\d+_/);
  });
});
