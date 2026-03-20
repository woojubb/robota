import type { ICommandSource, ISlashCommand } from './types.js';

/** Built-in commands for the CLI. Execute callbacks are wired externally (App.tsx). */
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
      subcommands: [
        { name: 'claude-opus-4-6', description: 'Opus 4.6 (highest quality)', source: 'builtin' },
        { name: 'claude-sonnet-4-6', description: 'Sonnet 4.6 (balanced)', source: 'builtin' },
        { name: 'claude-haiku-4-5', description: 'Haiku 4.5 (fastest)', source: 'builtin' },
      ],
    },
    { name: 'compact', description: 'Compress context window', source: 'builtin' },
    { name: 'cost', description: 'Show session info', source: 'builtin' },
    { name: 'context', description: 'Context window info', source: 'builtin' },
    { name: 'permissions', description: 'Permission rules', source: 'builtin' },
    { name: 'exit', description: 'Exit CLI', source: 'builtin' },
  ];
}

/** Command source for built-in CLI commands */
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
