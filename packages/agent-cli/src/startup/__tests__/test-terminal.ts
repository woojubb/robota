import type { ISpinner, ITerminalOutput } from '@robota-sdk/agent-core';

export interface ICapturingTerminal {
  terminal: ITerminalOutput;
  lines: string[];
  errors: string[];
}

export function createCapturingTerminal(): ICapturingTerminal {
  const lines: string[] = [];
  const errors: string[] = [];
  const terminal: ITerminalOutput = {
    write: (text: string) => {
      lines.push(text);
    },
    writeLine: (text: string) => {
      lines.push(text);
    },
    writeMarkdown: (md: string) => {
      lines.push(md);
    },
    writeError: (text: string) => {
      errors.push(text);
    },
    prompt: () => Promise.resolve(''),
    select: () => Promise.resolve(0),
    spinner: (): ISpinner => ({
      update: () => undefined,
      stop: () => undefined,
    }),
  };
  return { terminal, lines, errors };
}
