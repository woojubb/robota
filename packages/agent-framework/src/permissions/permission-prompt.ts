/**
 * Interactive permission prompt — asks the user whether to allow a tool invocation
 * using an arrow-key selector. Canonical implementation (SSOT).
 * Used by both agent-sdk query() and agent-cli.
 */

import { consentScopeFor as sessionConsentScopeFor } from '@robota-sdk/agent-session';

import type { TPermissionResultValue } from '../interactive/types.js';
import type { ITerminalOutput } from '../types.js';
import type { TToolArgs } from '@robota-sdk/agent-core';

/**
 * Issue #2351: the permission pattern a "don't ask again" answer for this invocation grants — the
 * scope the enforcer remembers, so every prompt surface prints the same words.
 *
 * The rule is owned by agent-session; this is the framework's OWN facade over it rather than a
 * pass-through re-export of the owner's binding. `agent-transport-tui`'s permission prompt reads it
 * and depends on this package alone, never on agent-session, and `sdk-public-surface` refuses the
 * public graph passing through the owner directly.
 */
export function consentScopeFor(toolName: string, toolArgs: TToolArgs): string {
  return sessionConsentScopeFor(toolName, toolArgs);
}

// Issue #2351: the session option names the SCOPE it grants, computed the same way the enforcer
// remembers it, so the user reads exactly what "don't ask again" will cover.
function permissionOptions(scope: string): string[] {
  return ['Allow once', `Allow ${scope} for this session`, 'Deny'];
}
const ALLOW_ONCE_INDEX = 0;
const ALLOW_SESSION_INDEX = 1;

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
): Promise<TPermissionResultValue> {
  terminal.writeLine('');
  terminal.writeError(`[Permission Required] Tool: ${toolName}`);
  terminal.writeLine(`  ${formatArgs(toolArgs)}`);
  terminal.writeLine('');

  const selected = await terminal.select(
    permissionOptions(consentScopeFor(toolName, toolArgs)),
    ALLOW_ONCE_INDEX,
  );
  if (selected === ALLOW_SESSION_INDEX) return 'allow-session';
  return selected === ALLOW_ONCE_INDEX;
}
