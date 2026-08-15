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

/**
 * Derive the concrete remediation hint for the hard-capacity notice from the composed command set.
 * Returns `undefined` when no context-reduction command is registered, leaving the neutral core
 * default (`DEFAULT_CONTEXT_CAPACITY_HINT`) in force.
 */
export function deriveContextCapacityHint(
  contextReductionCommandName: string | undefined,
): string | undefined {
  if (!contextReductionCommandName) return undefined;
  return `Run /${contextReductionCommandName} and retry.`;
}
