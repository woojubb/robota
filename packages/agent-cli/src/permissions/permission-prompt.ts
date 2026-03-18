/**
 * Interactive permission prompt — asks the user whether to allow a tool invocation.
 */

import type { ITerminalOutput } from '../types.js';

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
 * Displays the tool name and arguments, then asks "Allow? [y/N]".
 * Returns true if the user types "y" or "yes" (case-insensitive), false otherwise.
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
  terminal.writeLine(`[Permission Required] Tool: ${toolName}`);
  terminal.writeLine(`  Arguments: ${formatArgs(toolArgs)}`);

  const answer = await terminal.prompt('Allow? [y/N] ');
  const normalised = answer.trim().toLowerCase();
  return normalised === 'y' || normalised === 'yes';
}
