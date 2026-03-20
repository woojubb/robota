/**
 * CLI-specific types for terminal I/O abstraction.
 */

/**
 * Spinner handle returned by ITerminalOutput.spinner()
 */
export interface ISpinner {
  stop(): void;
  update(message: string): void;
}

/**
 * Terminal output abstraction — injected into all components that need I/O
 */
export interface ITerminalOutput {
  write(text: string): void;
  writeLine(text: string): void;
  writeMarkdown(md: string): void;
  writeError(text: string): void;
  prompt(question: string): Promise<string>;
  /** Arrow-key selector. Returns the index of the chosen option. */
  select(options: string[], initialIndex?: number): Promise<number>;
  spinner(message: string): ISpinner;
}
