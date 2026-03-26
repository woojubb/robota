/**
 * System commands — SDK-level command execution logic.
 *
 * Pure functions that operate on InteractiveSession.
 * No React, no TUI, no framework dependencies.
 * CLI wraps these as slash commands with UI chrome.
 */

import type { TPermissionMode } from '@robota-sdk/agent-core';
import type { InteractiveSession } from '../interactive/interactive-session.js';

/** Result of a system command execution. */
export interface ICommandResult {
  /** Human-readable output message */
  message: string;
  /** Command completed successfully */
  success: boolean;
  /** Additional structured data (command-specific) */
  data?: Record<string, unknown>;
}

/** A system command with name, description, and execute logic. */
export interface ISystemCommand {
  name: string;
  description: string;
  execute(session: InteractiveSession, args: string): Promise<ICommandResult> | ICommandResult;
}

const VALID_MODES: TPermissionMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];

/** Built-in system commands. */
export function createSystemCommands(): ISystemCommand[] {
  return [
    {
      name: 'help',
      description: 'Show available commands',
      execute: (_session, _args) => ({
        message: [
          'Available commands:',
          '  help              — Show this help',
          '  clear             — Clear conversation',
          '  compact [instr]   — Compact context (optional focus instructions)',
          '  mode [m]          — Show/change permission mode',
          '  model <id>        — Change AI model',
          '  language <code>   — Set response language (ko, en, ja, zh)',
          '  cost              — Show session info',
          '  context           — Context window info',
          '  permissions       — Permission rules',
          '  resume            — Resume a previous session',
          '  rename <name>     — Rename the current session',
          '  reset             — Delete settings and exit',
        ].join('\n'),
        success: true,
      }),
    },
    {
      name: 'clear',
      description: 'Clear conversation history',
      execute: (session, _args) => {
        const underlying = session.getSession();
        underlying.clearHistory();
        return { message: 'Conversation cleared.', success: true };
      },
    },
    {
      name: 'compact',
      description: 'Compress context window',
      execute: async (session, args) => {
        const underlying = session.getSession();
        const instructions = args.trim() || undefined;
        const before = underlying.getContextState().usedPercentage;
        await underlying.compact(instructions);
        const after = underlying.getContextState().usedPercentage;
        return {
          message: `Context compacted: ${Math.round(before)}% -> ${Math.round(after)}%`,
          success: true,
          data: { before, after },
        };
      },
    },
    {
      name: 'mode',
      description: 'Show/change permission mode',
      execute: (session, args) => {
        const underlying = session.getSession();
        const arg = args.trim().split(/\s+/)[0];
        if (!arg) {
          return {
            message: `Current mode: ${underlying.getPermissionMode()}`,
            success: true,
            data: { mode: underlying.getPermissionMode() },
          };
        }
        if (VALID_MODES.includes(arg as TPermissionMode)) {
          underlying.setPermissionMode(arg as TPermissionMode);
          return {
            message: `Permission mode set to: ${arg}`,
            success: true,
            data: { mode: arg },
          };
        }
        return {
          message: `Invalid mode. Valid: ${VALID_MODES.join(' | ')}`,
          success: false,
        };
      },
    },
    {
      name: 'model',
      description: 'Change AI model',
      execute: (_session, args) => {
        const modelId = args.trim().split(/\s+/)[0];
        if (!modelId) {
          return { message: 'Usage: model <model-id>', success: false };
        }
        // Return the model ID — caller (InteractiveSession or client) applies the change
        return {
          message: `Model change requested: ${modelId}`,
          success: true,
          data: { modelId },
        };
      },
    },
    {
      name: 'language',
      description: 'Set response language',
      execute: (_session, args) => {
        const lang = args.trim().split(/\s+/)[0];
        if (!lang) {
          return { message: 'Usage: language <code> (e.g., ko, en, ja, zh)', success: false };
        }
        return {
          message: `Language set to "${lang}".`,
          success: true,
          data: { language: lang },
        };
      },
    },
    {
      name: 'cost',
      description: 'Show session info',
      execute: (session, _args) => {
        const underlying = session.getSession();
        const sessionId = underlying.getSessionId();
        const messageCount = underlying.getMessageCount();
        return {
          message: `Session: ${sessionId}\nMessages: ${messageCount}`,
          success: true,
          data: { sessionId, messageCount },
        };
      },
    },
    {
      name: 'context',
      description: 'Context window info',
      execute: (session, _args) => {
        const ctx = session.getContextState();
        return {
          message: `Context: ${ctx.usedTokens.toLocaleString()} / ${ctx.maxTokens.toLocaleString()} tokens (${Math.round(ctx.usedPercentage)}%)`,
          success: true,
          data: {
            usedTokens: ctx.usedTokens,
            maxTokens: ctx.maxTokens,
            percentage: ctx.usedPercentage,
          },
        };
      },
    },
    {
      name: 'permissions',
      description: 'Show permission rules',
      execute: (session, _args) => {
        const underlying = session.getSession();
        const mode = underlying.getPermissionMode();
        const sessionAllowed = underlying.getSessionAllowedTools();
        const lines = [`Permission mode: ${mode}`];
        if (sessionAllowed.length > 0) {
          lines.push(`Session-approved tools: ${sessionAllowed.join(', ')}`);
        } else {
          lines.push('No session-approved tools.');
        }
        return {
          message: lines.join('\n'),
          success: true,
          data: { mode, sessionAllowed },
        };
      },
    },
    {
      name: 'resume',
      description: 'Resume a previous session',
      execute: (_session, _args) => ({
        message: 'Opening session picker...',
        success: true,
        data: { triggerResumePicker: true },
      }),
    },
    {
      name: 'rename',
      description: 'Rename the current session',
      execute: (_session, args) => {
        const name = args.trim();
        if (!name) {
          return { message: 'Usage: rename <name>', success: false };
        }
        return {
          message: `Session renamed to "${name}".`,
          success: true,
          data: { name },
        };
      },
    },
    {
      name: 'reset',
      description: 'Delete settings',
      execute: (_session, _args) => {
        // Settings deletion logic — caller handles actual file I/O and exit
        return {
          message: 'Reset requested.',
          success: true,
          data: { resetRequested: true },
        };
      },
    },
  ];
}

/** Registry for system commands. */
export class SystemCommandExecutor {
  private readonly commands: Map<string, ISystemCommand>;

  constructor(commands?: ISystemCommand[]) {
    this.commands = new Map();
    for (const cmd of commands ?? createSystemCommands()) {
      this.commands.set(cmd.name, cmd);
    }
  }

  /** Register an additional command. */
  register(command: ISystemCommand): void {
    this.commands.set(command.name, command);
  }

  /** Execute a command by name. Returns null if command not found. */
  async execute(
    name: string,
    session: InteractiveSession,
    args: string,
  ): Promise<ICommandResult | null> {
    const cmd = this.commands.get(name);
    if (!cmd) return null;
    return await cmd.execute(session, args);
  }

  /** List all registered commands. */
  listCommands(): ISystemCommand[] {
    return [...this.commands.values()];
  }

  /** Check if a command exists. */
  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }
}
