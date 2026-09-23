/**
 * The Claude Code hook RESPONSE protocol: what an approving hook's stdout may say.
 *
 * This is a different contract from the outcome union in `types.ts`. The outcome says whether the
 * hook reached a verdict at all; this says what a response additionally requests — `continue: false`,
 * a `permissionDecision`, an `updatedInput`, injected context.
 *
 * `interpretAllowOutcome` is the whole interpretation of one approving body (issue #2191): what to
 * inject, whether it blocks, which `permissionDecision` it states and the `updatedInput` riding with
 * it. `runHooks` only loops and aggregates — priority across hooks and the result shape stay there.
 *
 * The two contracts are mostly independent, with ONE crossing point: `explicitBlockDirective` below. A body may
 * carry a directive that unambiguously means "block" while the `{ ok, reason }` verdict beside it is
 * undecodable, and that body HAS rendered a verdict — discarding it because a sibling field was
 * malformed would be fail-open in an enforcement gate, which is the defect SEC-015 exists to remove
 * rather than relocate.
 */

import type { THookEvent } from './types.js';

export type TPermissionDecision = 'allow' | 'deny' | 'ask' | 'defer';

/** Permission decision priority: deny=3 > defer=2 > ask=1 > allow=0 */
export const PERMISSION_PRIORITY: Record<string, number> = { deny: 3, defer: 2, ask: 1, allow: 0 };

/**
 * What one `allow` outcome's stdout asks of the runner — declarative, so the runner aggregates and
 * this module decides what a body MEANS.
 */
export interface IAllowInterpretation {
  /** Text to append to the collected stdout: raw output, injected context, a system message. */
  readonly context: readonly string[];
  /** Present when the body blocks. `context` is still appended before the runner returns. */
  readonly blockReason?: string;
  /** PreToolUse only: the decision the body states, when it is one the protocol names. */
  readonly permissionDecision?: TPermissionDecision;
  /** PreToolUse only: an input rewrite riding alongside a named `permissionDecision`. */
  readonly updatedInput?: Record<string, unknown>;
}

function isPermissionDecision(value: unknown): value is TPermissionDecision {
  return typeof value === 'string' && value in PERMISSION_PRIORITY;
}

function additionalContextOf(specific: unknown): string | undefined {
  if (specific === null || typeof specific !== 'object') return undefined;
  if (!('additionalContext' in specific)) return undefined;
  return String((specific as Record<string, unknown>)['additionalContext']);
}

/** Decode one approving hook's stdout per the protocol (Claude Code compatible) for `event`. */
export function interpretAllowOutcome(stdout: string, event: THookEvent): IAllowInterpretation {
  const json = parseHookJson(stdout);
  if (json === null) {
    // Raw text stdout (non-JSON)
    const raw = stdout.trim();
    return { context: raw ? [raw] : [] };
  }
  // Common: continue: false → block
  if (json['continue'] === false) {
    return {
      context: [],
      blockReason:
        typeof json['stopReason'] === 'string'
          ? json['stopReason']
          : 'Blocked by hook (continue: false)',
    };
  }
  const specific = json['hookSpecificOutput'];
  const context: string[] = [];
  if (event === 'UserPromptSubmit') {
    const additional = additionalContextOf(specific);
    // decision: "block" → block, carrying the context the hook attached
    if (json['decision'] === 'block') {
      return {
        context: additional ? [additional] : [],
        blockReason: 'Blocked by hook (decision: block)',
      };
    }
    // additionalContext without block → inject into stdout
    if (additional) context.push(additional);
  }
  let permissionDecision: TPermissionDecision | undefined;
  let updatedInput: Record<string, unknown> | undefined;
  if (event === 'PreToolUse' && specific !== null && typeof specific === 'object') {
    const record = specific as Record<string, unknown>;
    if (isPermissionDecision(record['permissionDecision'])) {
      permissionDecision = record['permissionDecision'];
      // deny → immediate block; nothing else in the body is read
      if (permissionDecision === 'deny') {
        return {
          context: [],
          blockReason: 'Blocked by hook (permissionDecision: deny)',
          permissionDecision,
        };
      }
      if (record['updatedInput'] !== undefined) {
        updatedInput = record['updatedInput'] as Record<string, unknown>;
      }
    }
  }
  // systemMessage → inject into stdout for AI context
  if (typeof json['systemMessage'] === 'string' && json['systemMessage']) {
    context.push(json['systemMessage']);
  }
  return {
    context,
    ...(permissionDecision !== undefined && { permissionDecision }),
    ...(updatedInput !== undefined && { updatedInput }),
  };
}

/** Parse hook stdout as JSON if it starts with '{', otherwise return null. */
function parseHookJson(stdout: string): Record<string, unknown> | null {
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
 * The reason an explicitly-blocking response gives, or `null` when the body requests no block ON
 * THIS EVENT.
 *
 * These three directives are the vocabulary `HOOK-CATALOG.md` names as blocking triggers, and each
 * is a decision the hook stated outright — unlike `ok`, which can be malformed into meaning nothing.
 * A body carrying one has spoken, whatever else in it did not decode.
 *
 * Scoped by event exactly as `runHooks` scopes them (issue #2196): `continue: false` blocks on every
 * event; `decision: "block"` is the `UserPromptSubmit` vocabulary; `permissionDecision: "deny"` is
 * the `PreToolUse` vocabulary. The decoder used to read all three on any event, so a body like
 * `{"ok": "maybe", "decision": "block"}` denied a tool call the runner would not have blocked — one
 * vocabulary, two sets of rules. Now there is one set.
 */
export function explicitBlockDirective(body: unknown, event: THookEvent): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;

  if (record['continue'] === false) {
    return typeof record['stopReason'] === 'string' && record['stopReason']
      ? record['stopReason']
      : 'Blocked by hook (continue: false)';
  }
  if (event === 'UserPromptSubmit' && record['decision'] === 'block') {
    return typeof record['reason'] === 'string' && record['reason']
      ? record['reason']
      : 'Blocked by hook (decision: block)';
  }
  if (event === 'PreToolUse') {
    const specific = record['hookSpecificOutput'];
    if (typeof specific === 'object' && specific !== null) {
      if ((specific as Record<string, unknown>)['permissionDecision'] === 'deny') {
        return 'Blocked by hook (permissionDecision: deny)';
      }
    }
  }
  return null;
}
