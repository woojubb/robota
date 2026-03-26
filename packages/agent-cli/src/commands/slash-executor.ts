/**
 * Slash command execution logic.
 * Pure functions that handle each slash command independently.
 * No React/Ink dependencies — operates through callback interfaces.
 */

import type { TPermissionMode } from '@robota-sdk/agent-core';
import {
  getUserSettingsPath,
  deleteSettings,
  readSettings,
  writeSettings,
} from '../utils/settings-io.js';
import type { CommandRegistry } from './command-registry.js';

/** Minimal session interface for slash command execution */
export interface ISlashSession {
  getPermissionMode(): TPermissionMode;
  setPermissionMode(mode: TPermissionMode): void;
  getSessionId(): string;
  getMessageCount(): number;
  getSessionAllowedTools(): string[];
  getContextState(): { usedTokens: number; maxTokens: number; usedPercentage: number };
  clearHistory(): void;
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
  /** If set, the caller should show a model change confirmation */
  pendingModelId?: string;
  /** If set, the caller should show a language change confirmation */
  pendingLanguage?: string;
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

const VALID_MODES: TPermissionMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];

export const HELP_TEXT = [
  'Available commands:',
  '  /help              — Show this help',
  '  /clear             — Clear conversation',
  '  /compact [instr]   — Compact context (optional focus instructions)',
  '  /mode [m]          — Show/change permission mode',
  '  /language [lang]   — Set response language (ko, en, ja, zh)',
  '  /cost              — Show session info',
  '  /resume            — Resume a previous session',
  '  /rename <name>     — Rename the current session',
  '  /reset             — Delete settings and exit',
  '  /exit              — Exit CLI',
].join('\n');

export function handleHelp(addMessage: TAddMessage): ISlashResult {
  addMessage({ role: 'system', content: HELP_TEXT });
  return { handled: true };
}

export function handleClear(
  addMessage: TAddMessage,
  clearMessages: TClearMessages,
  session: ISlashSession,
): ISlashResult {
  clearMessages();
  session.clearHistory();
  addMessage({ role: 'system', content: 'Conversation cleared.' });
  return { handled: true };
}

export async function handleCompact(
  args: string,
  session: ISlashSession,
  addMessage: TAddMessage,
): Promise<ISlashResult> {
  const instructions = args.trim() || undefined;
  const before = session.getContextState().usedPercentage;
  addMessage({ role: 'system', content: 'Compacting context...' });
  await session.compact(instructions);
  const after = session.getContextState().usedPercentage;
  addMessage({
    role: 'system',
    content: `Context compacted: ${Math.round(before)}% -> ${Math.round(after)}%`,
  });
  return { handled: true };
}

export function handleMode(
  arg: string | undefined,
  session: ISlashSession,
  addMessage: TAddMessage,
): ISlashResult {
  if (!arg) {
    addMessage({ role: 'system', content: `Current mode: ${session.getPermissionMode()}` });
  } else if (VALID_MODES.includes(arg as TPermissionMode)) {
    session.setPermissionMode(arg as TPermissionMode);
    addMessage({ role: 'system', content: `Permission mode set to: ${arg}` });
  } else {
    addMessage({ role: 'system', content: `Invalid mode. Valid: ${VALID_MODES.join(' | ')}` });
  }
  return { handled: true };
}

export function handleModel(modelId: string | undefined, addMessage: TAddMessage): ISlashResult {
  if (!modelId) {
    addMessage({ role: 'system', content: 'Select a model from the /model submenu.' });
    return { handled: true };
  }
  return { handled: true, pendingModelId: modelId };
}

export function handleCost(session: ISlashSession, addMessage: TAddMessage): ISlashResult {
  addMessage({
    role: 'system',
    content: `Session: ${session.getSessionId()}\nMessages: ${session.getMessageCount()}`,
  });
  return { handled: true };
}

export function handlePermissions(session: ISlashSession, addMessage: TAddMessage): ISlashResult {
  const mode = session.getPermissionMode();
  const sessionAllowed = session.getSessionAllowedTools();
  const lines = [`Permission mode: ${mode}`];
  if (sessionAllowed.length > 0) {
    lines.push(`Session-approved tools: ${sessionAllowed.join(', ')}`);
  } else {
    lines.push('No session-approved tools.');
  }
  addMessage({ role: 'system', content: lines.join('\n') });
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

export function handleLanguage(lang: string | undefined, addMessage: TAddMessage): ISlashResult {
  if (!lang) {
    addMessage({ role: 'system', content: 'Usage: /language <code> (e.g., ko, en, ja, zh)' });
    return { handled: true };
  }
  // Save to settings and request restart
  const settingsPath = getUserSettingsPath();
  const settings = readSettings(settingsPath);
  settings.language = lang;
  writeSettings(settingsPath, settings);
  addMessage({ role: 'system', content: `Language set to "${lang}". Restarting...` });
  return { handled: true, exitRequested: true };
}

export function handleReset(addMessage: TAddMessage): ISlashResult {
  const settingsPath = getUserSettingsPath();
  if (deleteSettings(settingsPath)) {
    addMessage({ role: 'system', content: `Deleted ${settingsPath}. Exiting...` });
  } else {
    addMessage({ role: 'system', content: 'No user settings found.' });
  }
  return { handled: true, exitRequested: true };
}

export async function handlePluginCommand(
  args: string,
  addMessage: TAddMessage,
  callbacks: IPluginCallbacks,
): Promise<ISlashResult> {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0] ?? '';
  const subArgs = parts.slice(1).join(' ').trim();

  try {
    switch (subcommand) {
      case '':
      case undefined:
      case 'manage': {
        return { handled: true, triggerPluginTUI: true };
      }
      case 'install': {
        if (!subArgs) {
          addMessage({ role: 'system', content: 'Usage: /plugin install <name>@<marketplace>' });
          return { handled: true };
        }
        await callbacks.install(subArgs);
        addMessage({ role: 'system', content: `Installed plugin: ${subArgs}` });
        return { handled: true };
      }
      case 'uninstall': {
        if (!subArgs) {
          addMessage({ role: 'system', content: 'Usage: /plugin uninstall <name>@<marketplace>' });
          return { handled: true };
        }
        await callbacks.uninstall(subArgs);
        addMessage({ role: 'system', content: `Uninstalled plugin: ${subArgs}` });
        return { handled: true };
      }
      case 'enable': {
        if (!subArgs) {
          addMessage({ role: 'system', content: 'Usage: /plugin enable <name>@<marketplace>' });
          return { handled: true };
        }
        await callbacks.enable(subArgs);
        addMessage({ role: 'system', content: `Enabled plugin: ${subArgs}` });
        return { handled: true };
      }
      case 'disable': {
        if (!subArgs) {
          addMessage({ role: 'system', content: 'Usage: /plugin disable <name>@<marketplace>' });
          return { handled: true };
        }
        await callbacks.disable(subArgs);
        addMessage({ role: 'system', content: `Disabled plugin: ${subArgs}` });
        return { handled: true };
      }
      case 'marketplace': {
        const mpParts = subArgs.split(/\s+/);
        const mpSubcommand = mpParts[0] ?? '';
        const mpArgs = mpParts.slice(1).join(' ').trim();

        if (mpSubcommand === 'add' && mpArgs) {
          const registeredName = await callbacks.marketplaceAdd(mpArgs);
          addMessage({
            role: 'system',
            content: `Added marketplace: "${registeredName}" (from ${mpArgs})\nInstall plugins with: /plugin install <name>@${registeredName}`,
          });
          return { handled: true };
        } else if (mpSubcommand === 'remove' && mpArgs) {
          await callbacks.marketplaceRemove(mpArgs);
          addMessage({
            role: 'system',
            content: `Removed marketplace "${mpArgs}" and uninstalled its plugins.`,
          });
          return { handled: true };
        } else if (mpSubcommand === 'update' && mpArgs) {
          await callbacks.marketplaceUpdate(mpArgs);
          addMessage({
            role: 'system',
            content: `Updated marketplace "${mpArgs}".`,
          });
          return { handled: true };
        } else if (mpSubcommand === 'list') {
          const sources = await callbacks.marketplaceList();
          if (sources.length === 0) {
            addMessage({ role: 'system', content: 'No marketplace sources configured.' });
          } else {
            const lines = sources.map((s) => `  ${s.name} (${s.type})`);
            addMessage({ role: 'system', content: `Marketplace sources:\n${lines.join('\n')}` });
          }
          return { handled: true };
        } else {
          addMessage({
            role: 'system',
            content:
              'Usage: /plugin marketplace add <source> | remove <name> | update <name> | list',
          });
          return { handled: true };
        }
      }
      default:
        addMessage({ role: 'system', content: `Unknown plugin subcommand: ${subcommand}` });
        return { handled: true };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    addMessage({ role: 'system', content: `Plugin error: ${message}` });
    return { handled: true };
  }
}

export async function handleReloadPlugins(
  addMessage: TAddMessage,
  callbacks: IPluginCallbacks,
): Promise<ISlashResult> {
  await callbacks.reloadPlugins();
  addMessage({ role: 'system', content: 'Plugins reload complete.' });
  return { handled: true };
}

/** Execute a parsed slash command. Returns result indicating what happened. */
export async function executeSlashCommand(
  cmd: string,
  args: string,
  session: ISlashSession,
  addMessage: TAddMessage,
  clearMessages: TClearMessages,
  registry: CommandRegistry,
  pluginCallbacks?: IPluginCallbacks,
): Promise<ISlashResult> {
  switch (cmd) {
    case 'help':
      return handleHelp(addMessage);
    case 'clear':
      return handleClear(addMessage, clearMessages, session);
    case 'compact':
      return handleCompact(args, session, addMessage);
    case 'mode':
      return handleMode(args.split(/\s+/)[0] || undefined, session, addMessage);
    case 'model':
      return handleModel(args.split(/\s+/)[0] || undefined, addMessage);
    case 'language':
      return handleLanguage(args.split(/\s+/)[0] || undefined, addMessage);
    case 'cost':
      return handleCost(session, addMessage);
    case 'permissions':
      return handlePermissions(session, addMessage);
    case 'context':
      return handleContext(session, addMessage);
    case 'reset':
      return handleReset(addMessage);
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
      const dynamicCmd = registry
        .getCommands()
        .find((c) => c.name === cmd && (c.source === 'skill' || c.source === 'plugin'));
      if (dynamicCmd) {
        addMessage({ role: 'system', content: `Invoking ${dynamicCmd.source}: ${cmd}` });
        return { handled: false }; // Signal caller to run as session prompt
      }
      addMessage({ role: 'system', content: `Unknown command "/${cmd}". Type /help for help.` });
      return { handled: true };
    }
  }
}
