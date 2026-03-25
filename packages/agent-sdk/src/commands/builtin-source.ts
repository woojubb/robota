import { CLAUDE_MODELS, formatTokenCount } from '@robota-sdk/agent-core';
import type { ICommandSource, ISlashCommand } from './types.js';

/** Build model subcommands dynamically from CLAUDE_MODELS */
function buildModelSubcommands(): ISlashCommand[] {
  const seen = new Set<string>();
  const commands: ISlashCommand[] = [];
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

/** Built-in commands. Execute callbacks are wired externally by clients. */
function createBuiltinCommands(): ISlashCommand[] {
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
    { name: 'plugin', description: 'Manage plugins', source: 'builtin' },
    { name: 'reload-plugins', description: 'Reload all plugin resources', source: 'builtin' },
    { name: 'reset', description: 'Delete settings and exit', source: 'builtin' },
    { name: 'exit', description: 'Exit CLI', source: 'builtin' },
  ];
}

/** Command source for built-in commands */
export class BuiltinCommandSource implements ICommandSource {
  readonly name = 'builtin';
  private readonly commands: ISlashCommand[];

  constructor() {
    this.commands = createBuiltinCommands();
  }

  getCommands(): ISlashCommand[] {
    return this.commands;
  }
}
