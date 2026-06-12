import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

import { getUserSettingsPath, resetUserConfig } from '@robota-sdk/agent-framework';

import type { ITerminalOutput } from '@robota-sdk/agent-core';

export interface IResetConfigOptions {
  /** --yes flag: skip the confirmation prompt. */
  yes: boolean;
  /** Whether stdin is a TTY (non-TTY without --yes refuses to delete). */
  isTTY: boolean;
  /** Confirmation prompt (test seam, default: readline y/N on stdin). */
  confirm?: (question: string) => Promise<boolean>;
}

async function confirmViaReadline(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

/**
 * CLI-070 confirmation matrix for the destructive `--reset` flag:
 * `--yes` → delete; TTY without `--yes` → y/N prompt (default N);
 * non-TTY without `--yes` → refuse with exit 1, file untouched.
 * Returns the process exit code.
 */
export async function runResetConfig(
  terminal: ITerminalOutput,
  options: IResetConfigOptions,
): Promise<number> {
  const path = getUserSettingsPath();
  if (!existsSync(path)) {
    terminal.writeLine('No user settings found.');
    return 0;
  }

  if (!options.yes) {
    if (!options.isTTY) {
      terminal.writeError(
        `--reset deletes ${path}. Refusing without confirmation in non-interactive mode — pass --yes to proceed.`,
      );
      return 1;
    }
    const confirm = options.confirm ?? confirmViaReadline;
    const confirmed = await confirm(`Delete ${path}? [y/N] `);
    if (!confirmed) {
      terminal.writeLine('Reset cancelled.');
      return 1;
    }
  }

  const result = resetUserConfig();
  if (result.deleted) {
    terminal.writeLine(`Deleted ${result.path}`);
  } else {
    terminal.writeLine('No user settings found.');
  }
  return 0;
}
