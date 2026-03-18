/**
 * Interactive permission prompt — asks the user whether to allow a tool invocation
 * using an arrow-key selector.
 */

import chalk from 'chalk';
import type { ITerminalOutput } from '../types.js';

const PERMISSION_OPTIONS = ['Allow', 'Deny'];
const ALLOW_INDEX = 0;

/**
 * Format tool arguments as a human-readable string for display in the prompt.
 */
function formatArgs(toolArgs: Record<string, unknown>): string {
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
 *
 * Displays the tool name and arguments, then shows an arrow-key selector
 * with Allow / Deny options. Returns true if the user selects Allow.
 *
 * @param terminal  Terminal output / input abstraction
 * @param toolName  Name of the tool (e.g. "Bash")
 * @param toolArgs  Arguments passed to the tool
 */
export async function promptForApproval(
  terminal: ITerminalOutput,
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<boolean> {
  terminal.writeLine('');
  terminal.writeLine(chalk.yellow(`[Permission Required] Tool: ${toolName}`));
  terminal.writeLine(chalk.dim(`  ${formatArgs(toolArgs)}`));
  terminal.writeLine('');

  const selected = await terminal.select(PERMISSION_OPTIONS, ALLOW_INDEX);
  return selected === ALLOW_INDEX;
}
