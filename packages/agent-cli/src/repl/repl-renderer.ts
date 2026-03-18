/**
 * ReplRenderer — implements ITerminalOutput for interactive terminal use.
 *
 * - write / writeLine: direct stdout writes
 * - writeMarkdown: renders with marked + marked-terminal
 * - writeError: stderr with red color via chalk
 * - prompt: readline-based question
 * - spinner: text spinner with setInterval
 */

import * as readline from 'node:readline';
import chalk from 'chalk';
import { marked } from 'marked';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — marked-terminal has no type declarations
import TerminalRenderer from 'marked-terminal';
import type { ITerminalOutput, ISpinner } from '../types.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;
const SPINNER_CLEAR_PADDING = 3;

// Configure marked to render to the terminal once at module load
marked.setOptions({
  renderer: new TerminalRenderer(),
});

/**
 * Terminal output implementation for interactive REPL sessions.
 */
export class ReplRenderer implements ITerminalOutput {
  /** Write text to stdout without a trailing newline */
  write(text: string): void {
    process.stdout.write(text);
  }

  /** Write text to stdout with a trailing newline */
  writeLine(text: string): void {
    process.stdout.write(text + '\n');
  }

  /** Render markdown and write to stdout */
  writeMarkdown(md: string): void {
    const rendered = marked.parse(md);
    process.stdout.write(typeof rendered === 'string' ? rendered : md);
  }

  /** Write an error message to stderr in red */
  writeError(text: string): void {
    process.stderr.write(chalk.red(text) + '\n');
  }

  /** Prompt the user with a question and return their answer */
  prompt(question: string): Promise<string> {
    return new Promise<string>((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });

      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  /** Display a text spinner with the given message. Returns handle to stop/update it. */
  spinner(message: string): ISpinner {
    let current = message;
    let frameIndex = 0;
    let active = true;

    const interval = setInterval(() => {
      if (!active) return;
      const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length] ?? '·';
      process.stdout.write(`\r${frame} ${current}`);
      frameIndex += 1;
    }, SPINNER_INTERVAL_MS);

    return {
      stop(): void {
        if (!active) return;
        active = false;
        clearInterval(interval);
        // Clear the spinner line
        process.stdout.write('\r' + ' '.repeat(current.length + SPINNER_CLEAR_PADDING) + '\r');
      },
      update(newMessage: string): void {
        current = newMessage;
      },
    };
  }
}
