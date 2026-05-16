import type { ICommandHostContext, ICommandListEntry } from '../host-context.js';

export const HELP_COMMAND_DESCRIPTION = 'Show available commands';
const HELP_COMMAND_NAME_COLUMN_WIDTH = 16;

function readCommandList(context: ICommandHostContext): readonly ICommandListEntry[] {
  return context.listCommands?.() ?? [];
}

export function formatCommandHelpMessage(context: ICommandHostContext): string {
  const commands = readCommandList(context);
  return [
    'Available commands:',
    ...commands.map((command) => {
      const displayLabel = command.displayName ?? command.name;
      const invocation = `/${command.name}`;
      const label = command.displayName ? `${displayLabel} (${invocation})` : invocation;
      return `  ${label.padEnd(HELP_COMMAND_NAME_COLUMN_WIDTH * 2)} — ${command.description}`;
    }),
  ].join('\n');
}
