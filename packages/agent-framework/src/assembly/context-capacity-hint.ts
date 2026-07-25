/**
 * NEUT-005 wave 2 — surface-derived context-capacity hint.
 *
 * The zero-dependency `agent-core` layer emits a product-neutral hard-capacity notice and exposes
 * the `IAgentConfig.contextCapacityHint` seam (a surface tier injects its own concrete remediation
 * wording). This framework tier owns command composition, so it can derive that wording from the
 * surface's OWN registered command set rather than hardcoding product vocabulary in a neutral core:
 * when a `compact` command is composed into the session, the notice can point users at it; when no
 * such command exists, no product wording is emitted and the neutral core default stands.
 */

import type { ICommandModule } from '../command-api/index.js';

/** The context-reduction command whose presence makes the hard-capacity notice actionable. */
const COMPACT_COMMAND_NAME = 'compact';

function hasCommand(modules: readonly ICommandModule[], commandName: string): boolean {
  for (const module of modules) {
    if (module.systemCommands?.some((command) => command.name === commandName)) return true;
    for (const source of module.commandSources ?? []) {
      if (source.getCommands().some((command) => command.name === commandName)) return true;
    }
  }
  return false;
}

/**
 * Derive the concrete remediation hint for the hard-capacity notice from the composed command set.
 * Returns `undefined` when no context-reduction command is registered, leaving the neutral core
 * default (`DEFAULT_CONTEXT_CAPACITY_HINT`) in force.
 */
export function deriveContextCapacityHint(
  commandModules: readonly ICommandModule[] | undefined,
): string | undefined {
  if (!commandModules || commandModules.length === 0) return undefined;
  if (!hasCommand(commandModules, COMPACT_COMMAND_NAME)) return undefined;
  return `Run /${COMPACT_COMMAND_NAME} and retry.`;
}
