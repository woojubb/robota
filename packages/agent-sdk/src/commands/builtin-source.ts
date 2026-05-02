import { CLAUDE_MODELS, formatTokenCount } from '@robota-sdk/agent-core';
import type { ICommandSource, ICommand } from './types.js';

/** Build model subcommands dynamically from CLAUDE_MODELS */
function buildModelSubcommands(): ICommand[] {
  const seen = new Set<string>();
  const commands: ICommand[] = [];
  for (const model of Object.values(CLAUDE_MODELS)) {
    if (seen.has(model.name)) continue;
    seen.add(model.name);
    commands.push({
      name: model.id,
      description: `${model.name} (${formatTokenCount(model.contextWindow).toUpperCase()})`,
      source: 'builtin',
    });
  }
  return commands;
}

function buildProviderSubcommands(): ICommand[] {
  return [
    { name: 'current', description: 'Show current provider', source: 'builtin' },
    { name: 'list', description: 'List provider profiles', source: 'builtin' },
    { name: 'use', description: 'Switch provider profile', source: 'builtin' },
    { name: 'test', description: 'Test provider profile', source: 'builtin' },
  ];
}

function buildBackgroundSubcommands(): ICommand[] {
  return [
    { name: 'list', description: 'List background tasks', source: 'builtin' },
    { name: 'read', description: 'Read a background task log page', source: 'builtin' },
    { name: 'cancel', description: 'Cancel a running background task', source: 'builtin' },
    { name: 'close', description: 'Dismiss a terminal background task', source: 'builtin' },
  ];
}

function buildRewindSubcommands(): ICommand[] {
  return [
    { name: 'list', description: 'List edit checkpoints', source: 'builtin' },
    { name: 'restore', description: 'Restore code to a checkpoint', source: 'builtin' },
    { name: 'code', description: 'Restore code to a checkpoint', source: 'builtin' },
  ];
}

function buildMemorySubcommands(): ICommand[] {
  return [
    { name: 'list', description: 'List project memory topics', source: 'builtin' },
    { name: 'show', description: 'Show project memory index or a topic', source: 'builtin' },
    { name: 'add', description: 'Save durable project memory', source: 'builtin' },
    { name: 'pending', description: 'List pending memory candidates', source: 'builtin' },
    { name: 'approve', description: 'Approve a pending memory candidate', source: 'builtin' },
    { name: 'reject', description: 'Reject a pending memory candidate', source: 'builtin' },
    {
      name: 'used',
      description: 'Show memory references used in the current turn',
      source: 'builtin',
    },
  ];
}

/** Built-in commands. Execute callbacks are wired externally by clients. */
function createBuiltinCommands(): ICommand[] {
  return [
    { name: 'help', description: 'Show available commands', source: 'builtin' },
    { name: 'clear', description: 'Clear conversation history', source: 'builtin' },
    {
      name: 'mode',
      description: 'Permission mode',
      source: 'builtin',
      subcommands: [
        { name: 'plan', description: 'Plan only, no execution', source: 'builtin' },
        { name: 'default', description: 'Ask before risky actions', source: 'builtin' },
        { name: 'acceptEdits', description: 'Auto-approve file edits', source: 'builtin' },
        { name: 'bypassPermissions', description: 'Skip all permission checks', source: 'builtin' },
      ],
    },
    {
      name: 'model',
      description: 'Select AI model',
      source: 'builtin',
      subcommands: buildModelSubcommands(),
    },
    {
      name: 'language',
      description: 'Set response language',
      source: 'builtin',
      subcommands: [
        { name: 'ko', description: 'Korean', source: 'builtin' },
        { name: 'en', description: 'English', source: 'builtin' },
        { name: 'ja', description: 'Japanese', source: 'builtin' },
        { name: 'zh', description: 'Chinese', source: 'builtin' },
      ],
    },
    { name: 'compact', description: 'Compress context window', source: 'builtin' },
    { name: 'cost', description: 'Show session info', source: 'builtin' },
    { name: 'context', description: 'Context window info', source: 'builtin' },
    { name: 'permissions', description: 'Permission rules', source: 'builtin' },
    {
      name: 'memory',
      description: 'Inspect, save, review, and audit project memory',
      source: 'builtin',
      subcommands: buildMemorySubcommands(),
    },
    {
      name: 'rewind',
      description: 'List and restore edit checkpoints',
      source: 'builtin',
      subcommands: buildRewindSubcommands(),
    },
    {
      name: 'provider',
      description: 'Manage provider profiles',
      source: 'builtin',
      subcommands: buildProviderSubcommands(),
    },
    { name: 'resume', description: 'Resume a previous session', source: 'builtin' },
    {
      name: 'background',
      description: 'List and control background tasks',
      source: 'builtin',
      subcommands: buildBackgroundSubcommands(),
    },
    { name: 'rename', description: 'Rename the current session', source: 'builtin' },
    { name: 'plugin', description: 'Manage plugins', source: 'builtin' },
    { name: 'reload-plugins', description: 'Reload all plugin resources', source: 'builtin' },
    { name: 'reset', description: 'Delete settings and exit', source: 'builtin' },
    { name: 'exit', description: 'Exit CLI', source: 'builtin' },
  ];
}

/** Command source for built-in commands */
export class BuiltinCommandSource implements ICommandSource {
  readonly name = 'builtin';
  private readonly commands: ICommand[];

  constructor() {
    this.commands = createBuiltinCommands();
  }

  getCommands(): ICommand[] {
    return this.commands;
  }
}
