/**
 * Reversible disable overlays (MCP-001).
 *
 * Disabling a server is not deleting its definition. The entry stays in the listing with its
 * provenance and a stated reason, because the operator's next question after "why is this server
 * not running" is "where is it configured" — and an entry that vanished cannot answer it. That is
 * also what makes the overlay reversible: re-enabling restores the identical resolved entry,
 * because nothing was removed to restore.
 *
 * An overlay naming a server that does not exist is REFUSED rather than ignored. Silently
 * accepting it would let a typo read as a successful disable, and the operator would learn
 * otherwise only when the server they meant to stop kept running.
 */

import type { IMCPResolvedEntry } from './types.js';

export interface IMCPDisableOverlay {
  /**
   * Server names to disable, each with the reason shown beside the entry.
   *
   * Optional, because "no server is disabled" is a real state a caller expresses as `{}` — and an
   * overlay that threw on it would make the empty case the one that crashes. Found by running the
   * MCP-001 scenario, which passed `{}` and got a TypeError out of `Object.keys(undefined)`.
   */
  readonly disabled?: Readonly<Record<string, string>>;
}

export class MCPOverlayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MCPOverlayError';
  }
}

/**
 * Apply a disable overlay to a resolved set.
 *
 * Entry order and content are otherwise untouched: the only change is `disabledReason` appearing on
 * the named entries.
 */
export function applyDisableOverlay(
  entries: readonly IMCPResolvedEntry[],
  overlay: IMCPDisableOverlay,
): readonly IMCPResolvedEntry[] {
  const disabled = overlay.disabled ?? {};
  const known = new Set(entries.map((entry) => entry.name));
  const unknown = Object.keys(disabled).filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new MCPOverlayError(
      `cannot disable unknown MCP server(s): ${unknown.join(', ')}. ` +
        `Known: ${[...known].sort().join(', ') || '(none)'}`,
    );
  }

  return entries.map((entry) => {
    const reason = disabled[entry.name];
    if (reason === undefined) return entry;
    return { ...entry, disabledReason: reason };
  });
}

/** Remove the overlay from one entry, restoring exactly what precedence produced. */
export function clearDisable(entry: IMCPResolvedEntry): IMCPResolvedEntry {
  if (entry.disabledReason === undefined) return entry;
  const { disabledReason: _ignored, ...rest } = entry;
  return rest;
}

/** Whether an entry is currently disabled. */
export function isDisabled(entry: IMCPResolvedEntry): boolean {
  return entry.disabledReason !== undefined;
}
