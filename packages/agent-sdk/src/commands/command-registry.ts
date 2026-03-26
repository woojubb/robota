import type { ICommandSource, ICommand } from './types.js';

/** Aggregates commands from multiple sources */
export class CommandRegistry {
  private sources: ICommandSource[] = [];

  addSource(source: ICommandSource): void {
    this.sources.push(source);
  }

  /** Get all commands, optionally filtered by prefix */
  getCommands(filter?: string): ICommand[] {
    const all: ICommand[] = [];
    for (const source of this.sources) {
      all.push(...source.getCommands());
    }
    if (!filter) return all;
    const lower = filter.toLowerCase();
    return all.filter((cmd) => cmd.name.toLowerCase().startsWith(lower));
  }

  /** Resolve a short name to its fully qualified plugin:name form */
  resolveQualifiedName(shortName: string): string | null {
    const matches = this.getCommands().filter(
      (c) => c.source === 'plugin' && c.name.includes(':') && c.name.endsWith(`:${shortName}`),
    );
    if (matches.length !== 1) return null;
    return matches[0]!.name;
  }

  /** Get subcommands for a specific command */
  getSubcommands(commandName: string): ICommand[] {
    const lower = commandName.toLowerCase();
    for (const source of this.sources) {
      for (const cmd of source.getCommands()) {
        if (cmd.name.toLowerCase() === lower && cmd.subcommands) {
          return cmd.subcommands;
        }
      }
    }
    return [];
  }
}
