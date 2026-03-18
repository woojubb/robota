/**
 * REPL session loop — reads user input line-by-line, dispatches to slash command
 * handler or session.run(), and writes responses.
 *
 * The loop terminates on:
 * - /exit command
 * - Ctrl+C (SIGINT)
 * - Ctrl+D (EOF / readline close)
 */

import * as readline from 'node:readline';
import type { Session } from '../session.js';
import type { ITerminalOutput } from '../types.js';
import type { SessionStore } from '../session-store.js';
import type { ReplRenderer } from './repl-renderer.js';
import { handleSlashCommand } from './repl-commands.js';

const PROMPT_SYMBOL = '> ';
const WELCOME_BANNER_WIDTH = 60;

const ASCII_LOGO = `
  ____   ___  ____   ___ _____  _
 |  _ \\ / _ \\| __ ) / _ \\_   _|/ \\
 | |_) | | | |  _ \\| | | || | / _ \\
 |  _ <| |_| | |_) | |_| || |/ ___ \\
 |_| \\_\\\\___/|____/ \\___/ |_/_/   \\_\\
`;

/** Print the startup banner with ASCII art, project name and permission mode */
function printWelcome(terminal: ITerminalOutput, session: Session, projectName?: string): void {
  terminal.writeLine(ASCII_LOGO);
  if (projectName) {
    terminal.writeLine(`  ${projectName}`);
  }
  terminal.writeLine(`  Permission mode: ${session.getPermissionMode()}`);
  terminal.writeLine('  Type /help for commands, /exit or Ctrl+C to quit.');
  terminal.writeLine('');
}

/**
 * Start the interactive REPL loop.
 *
 * @param session      Active Session instance
 * @param terminal     Terminal output (used for display and prompts)
 * @param sessionStore Optional session store for /resume command
 * @param projectName  Optional project name shown in the welcome banner
 */
export async function startRepl(
  session: Session,
  terminal: ITerminalOutput,
  sessionStore?: SessionStore,
  projectName?: string,
): Promise<void> {
  printWelcome(terminal, session, projectName);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: PROMPT_SYMBOL,
    terminal: true,
  });

  // Share the readline instance with the terminal so permission prompts work
  if ('setReadline' in terminal) {
    (terminal as ReplRenderer).setReadline(rl);
  }

  rl.prompt();

  await new Promise<void>((resolve) => {
    rl.on('line', (line: string) => {
      const trimmed = line.trim();

      // Skip blank lines
      if (trimmed.length === 0) {
        rl.prompt();
        return;
      }

      // Check for slash command first
      const cmdResult = handleSlashCommand(trimmed, session, terminal, sessionStore);
      if (cmdResult.handled) {
        if (cmdResult.exit) {
          rl.close();
          return;
        }
        rl.prompt();
        return;
      }

      // Regular message — send to agent
      const spinner = terminal.spinner('Thinking…');
      session
        .run(trimmed)
        .then((response) => {
          spinner.stop();
          terminal.writeLine('');
          terminal.writeMarkdown(response);
          terminal.writeLine('');
        })
        .catch((err: unknown) => {
          spinner.stop();
          const message = err instanceof Error ? err.message : String(err);
          terminal.writeError(`Error: ${message}`);
        })
        .finally(() => {
          rl.prompt();
        });
    });

    rl.on('close', () => {
      terminal.writeLine('\nGoodbye!');
      resolve();
    });

    rl.on('SIGINT', () => {
      terminal.writeLine('\n(Ctrl+C — type /exit to quit)');
      rl.prompt();
    });
  });
}
