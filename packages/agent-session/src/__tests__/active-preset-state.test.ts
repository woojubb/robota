/**
 * Tests for the PRESET-011 runtime active-preset state on Session.
 *
 * The active preset id is pure runtime state: it is initialized from
 * ISessionOptions.activePresetId (default 'default') and can be mutated via
 * setActivePresetId without re-applying any preset options (permission mode etc.).
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

describe('Session active preset state (PRESET-011)', () => {
  it('TC-01: initializes activePresetId from options', () => {
    const session = new Session({
      tools: [],
      provider: MOCK_PROVIDER as never,
      systemMessage: 'test',
      terminal: MOCK_TERMINAL as never,
      activePresetId: 'autonomous-builder',
    });

    expect(session.getActivePresetId()).toBe('autonomous-builder');
  });

  it("TC-02: defaults activePresetId to 'default' when not provided", () => {
    const session = new Session({
      tools: [],
      provider: MOCK_PROVIDER as never,
      systemMessage: 'test',
      terminal: MOCK_TERMINAL as never,
    });

    expect(session.getActivePresetId()).toBe('default');
  });

  it('TC-03: setActivePresetId mutates state only — no option re-application', () => {
    const session = new Session({
      tools: [],
      provider: MOCK_PROVIDER as never,
      systemMessage: 'test',
      terminal: MOCK_TERMINAL as never,
      permissionMode: 'acceptEdits',
    });

    const initialPermissionMode = session.getPermissionMode();
    expect(session.getActivePresetId()).toBe('default');

    session.setActivePresetId('careful-reviewer');

    expect(session.getActivePresetId()).toBe('careful-reviewer');
    // Pure state mutate: permission mode is unchanged (no re-application).
    expect(session.getPermissionMode()).toBe(initialPermissionMode);
  });
});
