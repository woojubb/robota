/**
 * The Claude Code hook RESPONSE protocol: what an approving hook's stdout may say.
 *
 * This is a different contract from the outcome union in `types.ts`. The outcome says whether the
 * hook reached a verdict at all; this says what a response additionally requests — `continue: false`,
 * a `permissionDecision`, an `updatedInput`, injected context.
 *
 * NOT YET THE WHOLE PROTOCOL. `runHooks` still interprets `additionalContext`, `systemMessage`,
 * `updatedInput` and the `permissionDecision` priority inline, so this module holds the protocol's
 * vocabulary rather than all of its interpretation. Extracting the rest means restructuring a loop
 * that mutates four accumulators and returns early from four places; it is worth doing and it is not
 * this leaf's scope. Recorded so the module's name is not read as a claim it does not yet meet.
 *
 * The two contracts are mostly independent, with ONE crossing point: `explicitBlockDirective` below. A body may
 * carry a directive that unambiguously means "block" while the `{ ok, reason }` verdict beside it is
 * undecodable, and that body HAS rendered a verdict — discarding it because a sibling field was
 * malformed would be fail-open in an enforcement gate, which is the defect SEC-015 exists to remove
 * rather than relocate.
 */

/** Permission decision priority: deny=3 > defer=2 > ask=1 > allow=0 */
export const PERMISSION_PRIORITY: Record<string, number> = { deny: 3, defer: 2, ask: 1, allow: 0 };

/** Parse hook stdout as JSON if it starts with '{', otherwise return null. */
export function parseHookJson(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // allow-fallback: hook stdout may be plain text; malformed JSON means raw stdout
    return null;
  }
}

/**
 * The reason an explicitly-blocking response gives, or `null` when the body requests no block.
 *
 * These three directives are the vocabulary `HOOK-CATALOG.md` names as blocking triggers, and each
 * is a decision the hook stated outright — unlike `ok`, which can be malformed into meaning nothing.
 * A body carrying one has spoken, whatever else in it did not decode.
 */
export function explicitBlockDirective(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;

  if (record['continue'] === false) {
    return typeof record['stopReason'] === 'string' && record['stopReason']
      ? record['stopReason']
      : 'Blocked by hook (continue: false)';
  }
  if (record['decision'] === 'block') {
    return typeof record['reason'] === 'string' && record['reason']
      ? record['reason']
      : 'Blocked by hook (decision: block)';
  }
  const specific = record['hookSpecificOutput'];
  if (typeof specific === 'object' && specific !== null) {
    if ((specific as Record<string, unknown>)['permissionDecision'] === 'deny') {
      return 'Blocked by hook (permissionDecision: deny)';
    }
  }
  return null;
}
