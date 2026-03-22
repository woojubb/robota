import { describe, it, expect, vi } from 'vitest';
import {
  handleHelp,
  handleClear,
  handleMode,
  handleModel,
  handleCost,
  handlePermissions,
  handleContext,
  handleReset,
  handleCompact,
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
    clearHistory: vi.fn(),
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

describe('handleClear', () => {
  it('clears messages and session history', () => {
    const { addMessage, messages } = createMockAddMessage();
    const clearMessages = vi.fn();
    const session = createMockSession();
    const result = handleClear(addMessage, clearMessages, session);
    expect(result.handled).toBe(true);
    expect(clearMessages).toHaveBeenCalled();
    expect(session.clearHistory).toHaveBeenCalled();
    expect(messages[0].content).toBe('Conversation cleared.');
  });
});

describe('handleMode', () => {
  it('shows current mode when no arg', () => {
    const { addMessage, messages } = createMockAddMessage();
    const session = createMockSession();
    handleMode(undefined, session, addMessage);
    expect(messages[0].content).toContain('Current mode: default');
  });

  it('sets valid mode', () => {
    const { addMessage, messages } = createMockAddMessage();
    const session = createMockSession();
    handleMode('plan', session, addMessage);
    expect(session.setPermissionMode).toHaveBeenCalledWith('plan');
    expect(messages[0].content).toContain('plan');
  });

  it('rejects invalid mode', () => {
    const { addMessage, messages } = createMockAddMessage();
    const session = createMockSession();
    handleMode('invalid', session, addMessage);
    expect(session.setPermissionMode).not.toHaveBeenCalled();
    expect(messages[0].content).toContain('Invalid mode');
  });
});

describe('handleModel', () => {
  it('shows message when no modelId', () => {
    const { addMessage, messages } = createMockAddMessage();
    const result = handleModel(undefined, addMessage);
    expect(result.handled).toBe(true);
    expect(result.pendingModelId).toBeUndefined();
    expect(messages[0].content).toContain('Select a model');
  });

  it('returns pendingModelId when modelId provided', () => {
    const { addMessage } = createMockAddMessage();
    const result = handleModel('claude-opus-4-6', addMessage);
    expect(result.handled).toBe(true);
    expect(result.pendingModelId).toBe('claude-opus-4-6');
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

describe('handlePermissions', () => {
  it('shows mode and no approved tools', () => {
    const { addMessage, messages } = createMockAddMessage();
    const session = createMockSession();
    handlePermissions(session, addMessage);
    expect(messages[0].content).toContain('Permission mode: default');
    expect(messages[0].content).toContain('No session-approved tools');
  });

  it('shows approved tools when present', () => {
    const { addMessage, messages } = createMockAddMessage();
    const session = createMockSession({ getSessionAllowedTools: () => ['Bash', 'Read'] });
    handlePermissions(session, addMessage);
    expect(messages[0].content).toContain('Bash, Read');
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

describe('handleCompact', () => {
  it('calls session.compact and shows before/after', async () => {
    const { addMessage, messages } = createMockAddMessage();
    let callCount = 0;
    const session = createMockSession({
      getContextState: () => {
        callCount++;
        return callCount === 1
          ? { usedTokens: 170000, maxTokens: 200000, usedPercentage: 85 }
          : { usedTokens: 60000, maxTokens: 200000, usedPercentage: 30 };
      },
      compact: vi.fn(),
    });
    await handleCompact('focus on API', session, addMessage);
    expect(session.compact).toHaveBeenCalledWith('focus on API');
    expect(messages[1].content).toContain('85%');
    expect(messages[1].content).toContain('30%');
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
      'clear',
      'compact',
      'mode',
      'model',
      'language',
      'cost',
      'permissions',
      'context',
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
