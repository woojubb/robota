import { describe, it, expect, vi } from 'vitest';
import {
  handleHelp,
  handleCost,
  handleContext,
  handleReset,
  executeSlashCommand,
  HELP_TEXT,
} from '../slash-executor.js';
import type { ISlashSession } from '../slash-executor.js';
import { CommandRegistry } from '../command-registry.js';
import { BuiltinCommandSource } from '../builtin-source.js';
import type { ICommandSource } from '../types.js';

// Prevent tests from modifying real ~/.robota/settings.json
vi.mock('../../utils/settings-io.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/settings-io.js')>();
  return {
    ...actual,
    deleteSettings: vi.fn().mockReturnValue(false),
    writeSettings: vi.fn(),
    readSettings: vi.fn().mockReturnValue({}),
  };
});

function createMockSession(overrides?: Partial<ISlashSession>): ISlashSession {
  return {
    getPermissionMode: () => 'default',
    setPermissionMode: vi.fn(),
    getSessionId: () => 'test-session-123',
    getMessageCount: () => 5,
    getSessionAllowedTools: () => [],
    getContextState: () => ({ usedTokens: 50000, maxTokens: 200000, usedPercentage: 25 }),
    compact: vi.fn(),
    ...overrides,
  };
}

function createMockAddMessage(): {
  addMessage: (msg: { role: string; content: string }) => void;
  messages: Array<{ role: string; content: string }>;
} {
  const messages: Array<{ role: string; content: string }> = [];
  return {
    addMessage: (msg) => messages.push(msg),
    messages,
  };
}

describe('handleHelp', () => {
  it('adds help text as system message', () => {
    const { addMessage, messages } = createMockAddMessage();
    const result = handleHelp(addMessage);
    expect(result.handled).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe(HELP_TEXT);
  });
});

describe('handleCost', () => {
  it('shows session id and message count', () => {
    const { addMessage, messages } = createMockAddMessage();
    const session = createMockSession();
    handleCost(session, addMessage);
    expect(messages[0].content).toContain('test-session-123');
    expect(messages[0].content).toContain('5');
  });
});

describe('handleContext', () => {
  it('shows context usage', () => {
    const { addMessage, messages } = createMockAddMessage();
    const session = createMockSession();
    handleContext(session, addMessage);
    expect(messages[0].content).toContain('50,000');
    expect(messages[0].content).toContain('200,000');
    expect(messages[0].content).toContain('25%');
  });
});

describe('handleReset', () => {
  it('returns exitRequested', () => {
    const { addMessage } = createMockAddMessage();
    const result = handleReset(addMessage);
    expect(result.handled).toBe(true);
    expect(result.exitRequested).toBe(true);
  });
});

function emptyRegistry(): CommandRegistry {
  return new CommandRegistry();
}

describe('executeSlashCommand', () => {
  it('dispatches /help', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const result = await executeSlashCommand(
      'help',
      '',
      createMockSession(),
      addMessage,
      vi.fn(),
      emptyRegistry(),
    );
    expect(result.handled).toBe(true);
    expect(messages[0].content).toContain('Available commands');
  });

  it('dispatches /exit with exitRequested', async () => {
    const { addMessage } = createMockAddMessage();
    const result = await executeSlashCommand(
      'exit',
      '',
      createMockSession(),
      addMessage,
      vi.fn(),
      emptyRegistry(),
    );
    expect(result.exitRequested).toBe(true);
  });

  it('routes /compact through the SDK system command instead of legacy CLI handling', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const session = createMockSession({ compact: vi.fn() });

    const result = await executeSlashCommand(
      'compact',
      'focus on API',
      session,
      addMessage,
      vi.fn(),
      emptyRegistry(),
    );

    expect(result.handled).toBe(false);
    expect(session.compact).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);
  });

  it('routes /model through the injected system command instead of legacy CLI handling', async () => {
    const { addMessage, messages } = createMockAddMessage();

    const result = await executeSlashCommand(
      'model',
      'claude-sonnet-4-6',
      createMockSession(),
      addMessage,
      vi.fn(),
      emptyRegistry(),
    );

    expect(result).toEqual({ handled: false });
    expect(messages).toHaveLength(0);
  });

  it('routes /mode through the injected system command instead of legacy CLI handling', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const session = createMockSession();

    const result = await executeSlashCommand(
      'mode',
      'plan',
      session,
      addMessage,
      vi.fn(),
      emptyRegistry(),
    );

    expect(result).toEqual({ handled: false });
    expect(session.setPermissionMode).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);
  });

  it('routes /language through the injected system command instead of legacy CLI handling', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const registry = new CommandRegistry();
    registry.addSource({
      name: 'language',
      getCommands: () => [
        { name: 'language', description: 'Set response language', source: 'language' },
      ],
    });

    const result = await executeSlashCommand(
      'language',
      'ko',
      createMockSession(),
      addMessage,
      vi.fn(),
      registry,
    );

    expect(result).toEqual({ handled: false });
    expect(messages).toHaveLength(0);
  });

  it('routes /permissions through the injected system command instead of legacy CLI handling', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const registry = new CommandRegistry();
    registry.addSource({
      name: 'permissions',
      getCommands: () => [
        { name: 'permissions', description: 'Show permission rules', source: 'permissions' },
      ],
    });

    const result = await executeSlashCommand(
      'permissions',
      '',
      createMockSession({ getSessionAllowedTools: () => ['Bash', 'Read'] }),
      addMessage,
      vi.fn(),
      registry,
    );

    expect(result).toEqual({ handled: false });
    expect(messages).toHaveLength(0);
  });

  it('routes /statusline through the injected system command instead of legacy CLI handling', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const registry = new CommandRegistry();
    registry.addSource({
      name: 'statusline',
      getCommands: () => [
        {
          name: 'statusline',
          description: 'Configure TUI status-line visibility',
          source: 'statusline',
        },
      ],
    });

    const result = await executeSlashCommand(
      'statusline',
      'off',
      createMockSession(),
      addMessage,
      vi.fn(),
      registry,
    );

    expect(result).toEqual({ handled: false });
    expect(messages).toHaveLength(0);
  });

  it('routes /clear through the injected session command instead of legacy CLI handling', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const registry = new CommandRegistry();
    registry.addSource({
      name: 'session',
      getCommands: () => [
        { name: 'clear', description: 'Clear conversation history', source: 'session' },
      ],
    });

    const result = await executeSlashCommand(
      'clear',
      '',
      createMockSession(),
      addMessage,
      vi.fn(),
      registry,
    );

    expect(result).toEqual({ handled: false });
    expect(messages).toHaveLength(0);
  });

  it('routes /rename through the injected session command instead of legacy CLI handling', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const registry = new CommandRegistry();
    registry.addSource({
      name: 'session',
      getCommands: () => [
        { name: 'rename', description: 'Rename the current session', source: 'session' },
      ],
    });

    const result = await executeSlashCommand(
      'rename',
      'my-session',
      createMockSession(),
      addMessage,
      vi.fn(),
      registry,
    );

    expect(result).toEqual({ handled: false });
    expect(messages).toHaveLength(0);
  });

  it('routes /resume through the injected session command instead of legacy CLI handling', async () => {
    const { addMessage, messages } = createMockAddMessage();
    const registry = new CommandRegistry();
    registry.addSource({
      name: 'session',
      getCommands: () => [
        { name: 'resume', description: 'Resume a previous session', source: 'session' },
      ],
    });

    const result = await executeSlashCommand(
      'resume',
      '',
      createMockSession(),
      addMessage,
      vi.fn(),
      registry,
    );

    expect(result).toEqual({ handled: false });
    expect(messages).toHaveLength(0);
  });

  it('returns handled=false for skill command', async () => {
    const { addMessage } = createMockAddMessage();
    const registry = new CommandRegistry();
    const source: ICommandSource = {
      name: 'skill',
      getCommands: () => [{ name: 'deploy', description: 'Deploy', source: 'skill' }],
    };
    registry.addSource(source);
    const result = await executeSlashCommand(
      'deploy',
      '',
      createMockSession(),
      addMessage,
      vi.fn(),
      registry,
    );
    expect(result.handled).toBe(false);
  });

  it('shows error for unknown command', async () => {
    const { addMessage, messages } = createMockAddMessage();
    await executeSlashCommand(
      'foobar',
      '',
      createMockSession(),
      addMessage,
      vi.fn(),
      emptyRegistry(),
    );
    expect(messages[0].content).toContain('Unknown command');
  });
});

/**
 * REGRESSION GUARD: Every builtin command registered in BuiltinCommandSource
 * must have a corresponding route in executeSlashCommand.
 * If this test fails, a new command was added to builtin-source.ts but
 * not wired into the switch statement in slash-executor.ts.
 */
describe('Command routing completeness', () => {
  const builtinSource = new BuiltinCommandSource();
  const allBuiltinCommands = builtinSource.getCommands();

  // Commands that executeSlashCommand should NOT show "Unknown command" for
  const topLevelNames = allBuiltinCommands.map((c) => c.name);

  // Mock plugin callbacks for commands that need them
  const mockPluginCallbacks = {
    listInstalled: vi.fn().mockResolvedValue([]),
    listAvailablePlugins: vi.fn().mockResolvedValue([]),
    install: vi.fn(),
    uninstall: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    marketplaceAdd: vi.fn(),
    marketplaceRemove: vi.fn(),
    marketplaceUpdate: vi.fn(),
    marketplaceList: vi.fn().mockResolvedValue([]),
    reloadPlugins: vi.fn(),
  };

  it.each(topLevelNames)('should route /%s without "Unknown command"', async (cmdName) => {
    const { addMessage, messages } = createMockAddMessage();
    await executeSlashCommand(
      cmdName,
      '',
      createMockSession(),
      addMessage,
      vi.fn(),
      emptyRegistry(),
      mockPluginCallbacks,
    );
    const lastMessage = messages[messages.length - 1]?.content ?? '';
    expect(lastMessage).not.toContain('Unknown command');
  });

  it('should have a route for every builtin command (completeness check)', () => {
    // This is the authoritative list of routed commands in executeSlashCommand.
    // Update this list when adding new commands.
    const routedCommands = [
      'help',
      'compact',
      'mode',
      'model',
      'cost',
      'context',
      'resume',
      'background',
      'memory',
      'rewind',
      'rename',
      'provider',
      'reset',
      'exit',
      'plugin',
      'reload-plugins',
    ];

    for (const cmd of topLevelNames) {
      expect(
        routedCommands,
        `Builtin command "${cmd}" is registered but not in routedCommands list. ` +
          `Add it to executeSlashCommand switch AND update this test.`,
      ).toContain(cmd);
    }
  });
});
