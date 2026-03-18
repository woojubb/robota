import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSlashCommand } from '../repl/repl-commands.js';
import type { ITerminalOutput, ISpinner, TPermissionMode } from '../types.js';
import type { Session } from '../session.js';
import type { SessionStore, ISessionRecord } from '../session-store.js';

// ---------------------------------------------------------------------------
// Minimal mocks
// ---------------------------------------------------------------------------

function makeTerminal(): ITerminalOutput & {
  lines: string[];
  errors: string[];
} {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    write: vi.fn((t: string) => {
      lines.push(t);
    }),
    writeLine: vi.fn((t: string) => {
      lines.push(t);
    }),
    writeMarkdown: vi.fn((t: string) => {
      lines.push(t);
    }),
    writeError: vi.fn((t: string) => {
      errors.push(t);
    }),
    prompt: vi.fn(async () => ''),
    spinner: vi.fn((): ISpinner => ({ stop: vi.fn(), update: vi.fn() })),
  };
}

function makeSession(
  overrides: Partial<{
    permissionMode: TPermissionMode;
    messageCount: number;
    historyLen: number;
    sessionId: string;
  }> = {},
): Session {
  let mode: TPermissionMode = overrides.permissionMode ?? 'default';
  const sessionId = overrides.sessionId ?? 'test-session-123';
  const messageCount = overrides.messageCount ?? 5;
  const history = Array.from({ length: overrides.historyLen ?? 8 }, (_, i) => ({ i }));

  return {
    getPermissionMode: vi.fn(() => mode),
    setPermissionMode: vi.fn((m: TPermissionMode) => {
      mode = m;
    }),
    getSessionId: vi.fn(() => sessionId),
    getMessageCount: vi.fn(() => messageCount),
    getHistory: vi.fn(() => history),
    clearHistory: vi.fn(),
    run: vi.fn(async () => ''),
    checkPermission: vi.fn(async () => true),
  } as unknown as Session;
}

function makeSessionStore(sessions: ISessionRecord[] = []): SessionStore {
  return {
    list: vi.fn(() => sessions),
    load: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
  } as unknown as SessionStore;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleSlashCommand', () => {
  let terminal: ReturnType<typeof makeTerminal>;
  let session: Session;

  beforeEach(() => {
    terminal = makeTerminal();
    session = makeSession();
  });

  it('returns handled: false for non-slash input', () => {
    const result = handleSlashCommand('hello world', session, terminal);
    expect(result).toEqual({ handled: false });
  });

  it('returns handled: false for empty input', () => {
    const result = handleSlashCommand('', session, terminal);
    expect(result).toEqual({ handled: false });
  });

  describe('/help', () => {
    it('writes help text and returns handled: true', () => {
      const result = handleSlashCommand('/help', session, terminal);
      expect(result).toEqual({ handled: true });
      expect(terminal.lines.some((l) => l.includes('available commands'))).toBe(true);
    });
  });

  describe('/clear', () => {
    it('clears history and confirms', () => {
      const result = handleSlashCommand('/clear', session, terminal);
      expect(result).toEqual({ handled: true });
      expect(session.clearHistory).toHaveBeenCalled();
      expect(terminal.lines.some((l) => l.includes('cleared'))).toBe(true);
    });
  });

  describe('/mode', () => {
    it('shows current mode when called with no arg', () => {
      session = makeSession({ permissionMode: 'acceptEdits' });
      const result = handleSlashCommand('/mode', session, terminal);
      expect(result).toEqual({ handled: true });
      expect(terminal.lines.some((l) => l.includes('acceptEdits'))).toBe(true);
    });

    it('changes mode to acceptEdits', () => {
      const result = handleSlashCommand('/mode acceptEdits', session, terminal);
      expect(result).toEqual({ handled: true });
      expect(session.setPermissionMode).toHaveBeenCalledWith('acceptEdits');
    });

    it('changes mode to plan', () => {
      const result = handleSlashCommand('/mode plan', session, terminal);
      expect(result).toEqual({ handled: true });
      expect(session.setPermissionMode).toHaveBeenCalledWith('plan');
    });

    it('changes mode to bypassPermissions', () => {
      const result = handleSlashCommand('/mode bypassPermissions', session, terminal);
      expect(result).toEqual({ handled: true });
      expect(session.setPermissionMode).toHaveBeenCalledWith('bypassPermissions');
    });

    it('writes error for invalid mode', () => {
      const result = handleSlashCommand('/mode superpower', session, terminal);
      expect(result).toEqual({ handled: true });
      expect(terminal.errors.some((e) => e.includes('superpower'))).toBe(true);
      expect(session.setPermissionMode).not.toHaveBeenCalled();
    });
  });

  describe('/resume', () => {
    it('shows message when no store provided', () => {
      const result = handleSlashCommand('/resume', session, terminal);
      expect(result).toEqual({ handled: true });
      expect(terminal.lines.some((l) => l.includes('No session store'))).toBe(true);
    });

    it('shows message when no sessions exist', () => {
      const store = makeSessionStore([]);
      const result = handleSlashCommand('/resume', session, terminal, store);
      expect(result).toEqual({ handled: true });
      expect(terminal.lines.some((l) => l.includes('No saved sessions'))).toBe(true);
    });

    it('lists sessions with store', () => {
      const sessions: ISessionRecord[] = [
        {
          id: 'abc123',
          cwd: '/home/user/project',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
          messages: [],
        },
      ];
      const store = makeSessionStore(sessions);
      const result = handleSlashCommand('/resume', session, terminal, store);
      expect(result).toEqual({ handled: true });
      expect(terminal.lines.some((l) => l.includes('abc123'))).toBe(true);
    });
  });

  describe('/cost', () => {
    it('shows session stats', () => {
      session = makeSession({ messageCount: 3, historyLen: 6, sessionId: 'sess-xyz' });
      const result = handleSlashCommand('/cost', session, terminal);
      expect(result).toEqual({ handled: true });
      expect(terminal.lines.some((l) => l.includes('sess-xyz'))).toBe(true);
      expect(terminal.lines.some((l) => l.includes('3'))).toBe(true);
      expect(terminal.lines.some((l) => l.includes('6'))).toBe(true);
    });
  });

  describe('/model', () => {
    it('returns handled: true and writes a message', () => {
      const result = handleSlashCommand('/model', session, terminal);
      expect(result).toEqual({ handled: true });
      expect(terminal.lines.length).toBeGreaterThan(0);
    });
  });

  describe('/exit', () => {
    it('returns handled: true and exit: true', () => {
      const result = handleSlashCommand('/exit', session, terminal);
      expect(result).toEqual({ handled: true, exit: true });
    });
  });

  describe('unknown command', () => {
    it('writes an error for unknown slash command', () => {
      const result = handleSlashCommand('/frobnicate', session, terminal);
      expect(result).toEqual({ handled: true });
      expect(terminal.errors.some((e) => e.includes('frobnicate'))).toBe(true);
    });
  });
});
