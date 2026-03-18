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
 *
 * When used inside a REPL, call setReadline() to share the REPL's readline
 * instance so that prompt() works correctly (stdin can only be owned by one
 * readline at a time).
 */
export class ReplRenderer implements ITerminalOutput {
  private rl: readline.Interface | undefined;
  private activeSpinner: ISpinner | undefined;

  /**
   * Attach the REPL readline instance so prompt() can reuse it.
   * Must be called before the REPL starts accepting input.
   */
  setReadline(rl: readline.Interface): void {
    this.rl = rl;
  }

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

  /**
   * Prompt the user with a question and return their answer.
   *
   * Always creates a temporary readline with no history so that arrow keys
   * don't navigate the REPL's command history. The REPL readline is paused
   * while the temporary one is active.
   */
  prompt(question: string): Promise<string> {
    // Pause the spinner so the prompt is visible
    if (this.activeSpinner) {
      this.activeSpinner.stop();
      this.activeSpinner = undefined;
    }

    // Pause the REPL readline to release stdin
    if (this.rl) {
      this.rl.pause();
    }

    return new Promise<string>((resolve) => {
      const tempRl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
        historySize: 0,
      });

      tempRl.question(question, (answer) => {
        tempRl.close();
        // Resume the REPL readline
        if (this.rl) {
          this.rl.resume();
        }
        resolve(answer);
      });
    });
  }

  /**
   * Option selector using readline's question().
   *
   * Displays numbered options and asks the user to pick one by entering
   * a number or shortcut key. No raw mode — works reliably with readline.
   */
  select(options: string[], initialIndex = 0): Promise<number> {
    // Pause spinner
    if (this.activeSpinner) {
      this.activeSpinner.stop();
      this.activeSpinner = undefined;
    }

    // Show options with numbers
    for (let i = 0; i < options.length; i++) {
      const marker = i === initialIndex ? chalk.cyan('▸') : ' ';
      const label = i === initialIndex ? chalk.cyan(options[i]) : chalk.dim(options[i]);
      process.stdout.write(`  ${marker} ${i + 1}) ${label}\n`);
    }

    // Build shortcut hint from first chars: e.g., "1/a=Allow, 2/d=Deny"
    const shortcuts = options.map((opt, i) => {
      const key = opt[0]?.toLowerCase() ?? String(i + 1);
      return `${i + 1}/${key}=${opt}`;
    });
    const hint = shortcuts.join(', ');
    const defaultLabel = options[initialIndex] ?? '';

    return this.prompt(`  Choose [${hint}] (default: ${defaultLabel}): `).then((answer) => {
      const trimmed = answer.trim().toLowerCase();

      // Empty → default
      if (trimmed === '') return initialIndex;

      // Number
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1 && num <= options.length) return num - 1;

      // First-letter shortcut
      for (let i = 0; i < options.length; i++) {
        if (options[i]?.[0]?.toLowerCase() === trimmed) return i;
      }

      // Fallback to default
      return initialIndex;
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

    const handle: ISpinner = {
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

    // Track so prompt() can pause it
    this.activeSpinner = handle;
    return handle;
  }
}
