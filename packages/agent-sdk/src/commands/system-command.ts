import type { TPermissionMode } from '@robota-sdk/agent-core';
import type { TCapabilitySafety } from '../capabilities/types.js';
import type { InteractiveSession } from '../interactive/interactive-session.js';
import { executeBackgroundCommand } from './background-command.js';
import { executeMemoryCommand } from './memory-command.js';
import { executeRewindCommand } from './rewind-command.js';
import type { ICommandResult } from './command-result.js';
import {
  buildBackgroundSubcommands,
  buildMemorySubcommands,
  buildModelSubcommands,
  buildRewindSubcommands,
  getAutoCompactThreshold,
  MEMORY_COMMAND_ARGUMENT_HINT,
  MEMORY_COMMAND_DESCRIPTION,
  PERCENT,
  VALID_MODES,
} from './system-command-metadata.js';
import type { ICommand } from './types.js';
export { SystemCommandExecutor } from './system-command-executor.js';
export type {
  ICommandInteraction,
  ICommandChoicePromptOption,
  ICommandResult,
  TCommandEffect,
  TCommandResultDataValue,
  TCommandInteractionPrompt,
} from './command-result.js';

export type TSystemCommandLifecycle = 'inline' | 'blocking' | 'background';

/** A system command with name, description, and execute logic. */
export interface ISystemCommand {
  name: string;
  description: string;
  modelInvocable?: boolean;
  userInvocable?: boolean;
  argumentHint?: string;
  safety?: TCapabilitySafety;
  subcommands?: readonly ICommand[];
  lifecycle?: TSystemCommandLifecycle;
  execute(session: InteractiveSession, args: string): Promise<ICommandResult> | ICommandResult;
}

interface ICommandListProvider {
  listCommands?: () => Array<{ name: string; description: string }>;
}

function formatHelpMessage(session: InteractiveSession): string {
  const provider = session as ICommandListProvider;
  const commands =
    provider.listCommands?.() ??
    createSystemCommands().map((command) => ({
      name: command.name,
      description: command.description,
    }));
  return [
    'Available commands:',
    ...commands.map((command) => `  ${command.name.padEnd(16)} — ${command.description}`),
  ].join('\n');
}

/** Built-in system commands. */
export function createSystemCommands(): ISystemCommand[] {
  return [
    {
      name: 'help',
      description: 'Show available commands',
      execute: (session, _args) => ({
        message: formatHelpMessage(session),
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
      argumentHint: '[instructions]',
      lifecycle: 'blocking',
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
      subcommands: [
        { name: 'plan', description: 'Plan only, no execution', source: 'builtin' },
        { name: 'default', description: 'Ask before risky actions', source: 'builtin' },
        { name: 'acceptEdits', description: 'Auto-approve file edits', source: 'builtin' },
        { name: 'bypassPermissions', description: 'Skip all permission checks', source: 'builtin' },
      ],
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
      subcommands: buildModelSubcommands(),
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
          effects: [{ type: 'model-change-requested', modelId }],
        };
      },
    },
    {
      name: 'language',
      description: 'Set response language',
      subcommands: [
        { name: 'ko', description: 'Korean', source: 'builtin' },
        { name: 'en', description: 'English', source: 'builtin' },
        { name: 'ja', description: 'Japanese', source: 'builtin' },
        { name: 'zh', description: 'Chinese', source: 'builtin' },
      ],
      execute: (_session, args) => {
        const lang = args.trim().split(/\s+/)[0];
        if (!lang) {
          return { message: 'Usage: language <code> (e.g., ko, en, ja, zh)', success: false };
        }
        return {
          message: `Language set to "${lang}".`,
          success: true,
          data: { language: lang },
          effects: [{ type: 'language-change-requested', language: lang }],
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
        const autoCompactThreshold = getAutoCompactThreshold(session);
        const autoCompactLine =
          autoCompactThreshold === false
            ? 'Auto compact: disabled'
            : `Auto compact: ${Math.round(autoCompactThreshold * PERCENT)}%`;
        return {
          message: [
            `Context: ${ctx.usedTokens.toLocaleString()} / ${ctx.maxTokens.toLocaleString()} tokens (${Math.round(ctx.usedPercentage)}%)`,
            autoCompactLine,
          ].join('\n'),
          success: true,
          data: {
            usedTokens: ctx.usedTokens,
            maxTokens: ctx.maxTokens,
            percentage: ctx.usedPercentage,
            autoCompactThreshold,
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
      name: 'memory',
      description: MEMORY_COMMAND_DESCRIPTION,
      modelInvocable: true,
      argumentHint: MEMORY_COMMAND_ARGUMENT_HINT,
      safety: 'write',
      subcommands: buildMemorySubcommands(),
      execute: executeMemoryCommand,
    },
    {
      name: 'rewind',
      description: 'List edit checkpoints or restore code to a previous checkpoint.',
      argumentHint: 'list | restore CHECKPOINT_ID | code CHECKPOINT_ID | rollback CHECKPOINT_ID',
      safety: 'write',
      subcommands: buildRewindSubcommands(),
      execute: executeRewindCommand,
    },
    {
      name: 'resume',
      description: 'Resume a previous session',
      execute: (_session, _args) => ({
        message: 'Opening session picker...',
        success: true,
        data: { triggerResumePicker: true },
        effects: [{ type: 'session-picker-requested' }],
      }),
    },
    {
      name: 'background',
      description: 'List and control background tasks',
      subcommands: buildBackgroundSubcommands(),
      execute: executeBackgroundCommand,
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
          effects: [{ type: 'session-renamed', name }],
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
          effects: [{ type: 'settings-reset-requested' }],
        };
      },
    },
  ];
}
