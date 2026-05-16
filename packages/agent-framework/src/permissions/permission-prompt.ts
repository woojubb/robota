/**
 * Interactive permission prompt — asks the user whether to allow a tool invocation
 * using an arrow-key selector. Canonical implementation (SSOT).
 * Used by both agent-sdk query() and agent-cli.
 */

import type { ITerminalOutput } from '../types.js';
import type { TToolArgs } from '@robota-sdk/agent-core';

const PERMISSION_OPTIONS = ['Allow', 'Deny'];
const ALLOW_INDEX = 0;

function formatArgs(toolArgs: TToolArgs): string {
  const entries = Object.entries(toolArgs);
  if (entries.length === 0) {
    return '(no arguments)';
  }
  return entries
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ');
}

export async function promptForApproval(
  terminal: ITerminalOutput,
  toolName: string,
  toolArgs: TToolArgs,
): Promise<boolean> {
  terminal.writeLine('');
  terminal.writeError(`[Permission Required] Tool: ${toolName}`);
  terminal.writeLine(`  ${formatArgs(toolArgs)}`);
  terminal.writeLine('');

  const selected = await terminal.select(PERMISSION_OPTIONS, ALLOW_INDEX);
  return selected === ALLOW_INDEX;
}
