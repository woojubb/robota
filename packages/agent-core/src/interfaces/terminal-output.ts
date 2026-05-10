/**
 * Terminal output abstraction — port interface for components that need I/O.
 * Owned by agent-core as a domain port. Implemented by agent-cli.
 */

export interface ISpinner {
  stop(): void;
  update(message: string): void;
}

export interface ITerminalOutput {
  write(text: string): void;
  writeLine(text: string): void;
  writeMarkdown(md: string): void;
  writeError(text: string): void;
  prompt(question: string): Promise<string>;
  select(options: string[], initialIndex?: number): Promise<number>;
  spinner(message: string): ISpinner;
}
