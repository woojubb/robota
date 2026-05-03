/**
 * Slash command execution logic.
 * Pure functions that handle each slash command independently.
 * No React/Ink dependencies — operates through callback interfaces.
 */

import type { TPermissionMode } from '@robota-sdk/agent-core';
import type { CommandRegistry } from './command-registry.js';
import { handlePluginCommand, handleReloadPlugins } from './slash-plugin-handlers.js';

/** Minimal session interface for slash command execution */
export interface ISlashSession {
  getPermissionMode(): TPermissionMode;
  setPermissionMode(mode: TPermissionMode): void;
  getSessionId(): string;
  getMessageCount(): number;
  getSessionAllowedTools(): string[];
  getContextState(): { usedTokens: number; maxTokens: number; usedPercentage: number };
  compact(instructions?: string): Promise<void>;
}

/** Callback for adding a message to the UI */
export type TAddMessage = (msg: { role: string; content: string }) => void;

/** Callback for clearing all messages */
export type TClearMessages = () => void;

/** Result of a slash command execution */
export interface ISlashResult {
  handled: boolean;
  /** If set, the caller should schedule an exit after a delay */
  exitRequested?: boolean;
  /** If set, the caller should open the plugin management TUI */
  triggerPluginTUI?: boolean;
}

/** Callback-based interface for plugin operations. Keeps CLI decoupled from SDK implementation. */
export interface IPluginCallbacks {
  listInstalled: () => Promise<Array<{ name: string; description: string; enabled: boolean }>>;
  listAvailablePlugins: (marketplace: string) => Promise<
    Array<{
      name: string;
      description: string;
      installed: boolean;
    }>
  >;
  install: (pluginId: string, scope?: 'user' | 'project') => Promise<void>;
  uninstall: (pluginId: string) => Promise<void>;
  enable: (pluginId: string) => Promise<void>;
  disable: (pluginId: string) => Promise<void>;
  marketplaceAdd: (source: string) => Promise<string>;
  marketplaceRemove: (name: string) => Promise<void>;
  marketplaceUpdate: (name: string) => Promise<void>;
  marketplaceList: () => Promise<Array<{ name: string; type: string }>>;
  reloadPlugins: () => Promise<void>;
}

export const HELP_TEXT = [
  'Available commands:',
  '  /help              — Show this help',
  '  /clear             — Clear conversation',
  '  /compact [instr]   — Compact context (optional focus instructions)',
  '  /mode [m]          — Show/change permission mode',
  '  /language [lang]   — Set response language (ko, en, ja, zh)',
  '  /cost              — Show session info',
  '  /resume            — Resume a previous session',
  '  /background        — List/cancel/close background tasks',
  '  /rewind            — List or restore edit checkpoints',
  '  /rename <name>     — Rename the current session',
  '  /reset             — Delete settings and exit',
  '  /exit              — Exit CLI',
].join('\n');

export function handleHelp(addMessage: TAddMessage): ISlashResult {
  addMessage({ role: 'system', content: HELP_TEXT });
  return { handled: true };
}

export function handleContext(session: ISlashSession, addMessage: TAddMessage): ISlashResult {
  const ctx = session.getContextState();
  addMessage({
    role: 'system',
    content: `Context: ${ctx.usedTokens.toLocaleString()} / ${ctx.maxTokens.toLocaleString()} tokens (${Math.round(ctx.usedPercentage)}%)`,
  });
  return { handled: true };
}

/** Execute a parsed slash command. Returns result indicating what happened. */
export async function executeSlashCommand(
  cmd: string,
  args: string,
  session: ISlashSession,
  addMessage: TAddMessage,
  _clearMessages: TClearMessages,
  registry: CommandRegistry,
  pluginCallbacks?: IPluginCallbacks,
): Promise<ISlashResult> {
  switch (cmd) {
    case 'help':
      return handleHelp(addMessage);
    case 'compact':
      return { handled: false }; // Route to SDK system command (context compaction)
    case 'mode':
      return { handled: false }; // Route to system command (permission mode)
    case 'model':
      return { handled: false }; // Route to system command (model change effect)
    case 'cost':
      return { handled: false }; // Route to injected session command (session info)
    case 'context':
      return handleContext(session, addMessage);
    case 'reset':
      return { handled: false }; // Route to injected reset command (settings reset effect)
    case 'provider':
      return { handled: false }; // TUI routes provider commands with settings side effects
    case 'background':
      return { handled: false }; // Route to SDK system command (background task controls)
    case 'memory':
      return { handled: false }; // Route to SDK system command (project memory controls)
    case 'rewind':
      return { handled: false }; // Route to SDK system command (edit checkpoint controls)
    case 'exit':
      return { handled: true, exitRequested: true };
    case 'plugin':
      if (pluginCallbacks) {
        return handlePluginCommand(args, addMessage, pluginCallbacks);
      }
      addMessage({ role: 'system', content: 'Plugin management is not available.' });
      return { handled: true };
    case 'reload-plugins':
      if (pluginCallbacks) {
        return handleReloadPlugins(addMessage, pluginCallbacks);
      }
      addMessage({ role: 'system', content: 'Plugin management is not available.' });
      return { handled: true };
    case 'resume':
      return { handled: false }; // Route to system command (triggers session picker)
    case 'rename':
      return { handled: false }; // Route to system command (sets session name)
    default: {
      const dynamicCmd = registry.getCommands().find((c) => c.name === cmd);
      if (dynamicCmd) {
        if (dynamicCmd.source === 'skill' || dynamicCmd.source === 'plugin') {
          addMessage({ role: 'system', content: `Invoking ${dynamicCmd.source}: ${cmd}` });
        }
        return { handled: false }; // Signal caller to run as session prompt
      }
      addMessage({ role: 'system', content: `Unknown command "/${cmd}". Type /help for help.` });
      return { handled: true };
    }
  }
}
