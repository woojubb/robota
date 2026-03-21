/**
 * ITerminalOutput implementation for print mode (-p).
 *
 * Writes to stdout/stderr directly. The readline-based prompt and select are
 * only invoked if the agent triggers a permission-gated tool, which is rare in
 * one-shot print mode but must still work correctly.
 */

import * as readline from 'node:readline';
import type { ITerminalOutput, ISpinner } from './types.js';

export class PrintTerminal implements ITerminalOutput {
  write(text: string): void {
    process.stdout.write(text);
  }
  writeLine(text: string): void {
    process.stdout.write(text + '\n');
  }
  writeMarkdown(md: string): void {
    process.stdout.write(md);
  }
  writeError(text: string): void {
    process.stderr.write(text + '\n');
  }
  prompt(question: string): Promise<string> {
    return new Promise<string>((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
        historySize: 0,
      });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
  async select(options: string[], initialIndex = 0): Promise<number> {
    for (let i = 0; i < options.length; i++) {
      const marker = i === initialIndex ? '>' : ' ';
      process.stdout.write(`  ${marker} ${i + 1}) ${options[i]}\n`);
    }
    const answer = await this.prompt(
      `  Choose [1-${options.length}] (default: ${options[initialIndex]}): `,
    );
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === '') return initialIndex;
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= options.length) return num - 1;
    return initialIndex;
  }
  spinner(_message: string): ISpinner {
    return { stop(): void {}, update(): void {} };
  }
}
