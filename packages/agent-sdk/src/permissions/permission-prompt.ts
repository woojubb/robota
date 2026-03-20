/**
 * Permission prompt — this is now CLI-specific.
 * Re-exported here for backward compatibility.
 * The canonical implementation lives in @robota-sdk/agent-cli.
 */

import chalk from 'chalk';
import type { ITerminalOutput } from '../types.js';
import type { TToolArgs } from '@robota-sdk/agent-core';

const PERMISSION_OPTIONS = ['Allow', 'Deny'];
const ALLOW_INDEX = 0;

/**
 * Format tool arguments as a human-readable string for display in the prompt.
 */
function formatArgs(toolArgs: TToolArgs): string {
  const entries = Object.entries(toolArgs);
  if (entries.length === 0) {
    return '(no arguments)';
  }
  return entries
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ');
}

/**
 * Prompt the user for approval before running a tool.
 */
export async function promptForApproval(
  terminal: ITerminalOutput,
  toolName: string,
  toolArgs: TToolArgs,
): Promise<boolean> {
  terminal.writeLine('');
  terminal.writeLine(chalk.yellow(`[Permission Required] Tool: ${toolName}`));
  terminal.writeLine(chalk.dim(`  ${formatArgs(toolArgs)}`));
  terminal.writeLine('');

  const selected = await terminal.select(PERMISSION_OPTIONS, ALLOW_INDEX);
  return selected === ALLOW_INDEX;
}
