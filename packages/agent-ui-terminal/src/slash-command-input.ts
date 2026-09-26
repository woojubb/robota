/** A typed `/name args` line, split the way every TUI channel dispatches it. */
export interface ISlashCommandInput {
  /** Lower-cased, without the slash. */
  readonly name: string;
  readonly args: string;
}

export function parseSlashCommandInput(input: string): ISlashCommandInput {
  const parts = input.slice(1).split(/\s+/);
  return { name: parts[0]?.toLowerCase() ?? '', args: parts.slice(1).join(' ') };
}
