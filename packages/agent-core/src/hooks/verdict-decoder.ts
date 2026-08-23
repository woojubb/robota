/**
 * SEC-015 — the one decoder for a `{ ok, reason }` hook verdict.
 *
 * The HTTP, prompt, and agent executors all receive a hook's answer as this shape, and all three
 * decoded it the same wrong way: `(body as { ok: boolean }).ok` followed by a truthiness test. That
 * is not a decode, it is a coercion, and it fails in both directions — `{"ok": "false"}` is truthy
 * so the gate was disabled, while `{}` and `{"ok": null}` are falsy so a tool call was blocked by a
 * verdict no endpoint issued.
 *
 * `ok` must therefore be EXACTLY `true` or EXACTLY `false`. Everything else is the absence of a
 * verdict, not a quiet vote for one — UNLESS the same body carries an explicit block directive from
 * the Claude Code response protocol (`continue: false`, `decision: "block"`,
 * `permissionDecision: "deny"`), which is a decision the hook stated outright and which an
 * undecodable `ok` beside it does not retract.
 */

import { explicitBlockDirective } from './response-protocol.js';

import type { THookDefinition, THookOutcome } from './types.js';

/** How much of an undecodable payload to quote back. Enough to identify it, not enough to flood a log. */
const REASON_EXCERPT_LIMIT = 200;

/** A one-line, length-capped rendering of whatever arrived, for the `error` reason. */
function excerpt(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  return collapsed.length > REASON_EXCERPT_LIMIT
    ? `${collapsed.slice(0, REASON_EXCERPT_LIMIT)}…`
    : collapsed;
}

/**
 * Decode a hook's RAW response text into an outcome — parsing included.
 *
 * Parsing lives here rather than at each call site because it was the same three lines in the HTTP,
 * prompt and agent executors, which is the shape this module exists to collapse. A body that is not
 * JSON and a body whose `ok` is not a boolean are both "no verdict could be read", and both quote
 * the payload back the same way.
 *
 * @param raw - The response text as it arrived.
 * @param source - The executor doing the decoding, carried onto the outcome for diagnostics.
 */
export function decodeHookVerdict(raw: string, source: THookDefinition['type']): THookOutcome {
  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch (err: unknown) {
    return {
      outcome: 'error',
      source,
      kind: 'malformed-response',
      reason: `Hook response is not valid JSON (${err instanceof Error ? err.message : String(err)}): ${excerpt(raw)}`,
    };
  }
  return decodeParsedVerdict(body, source, raw);
}

/** The decode proper, once the text is known to be JSON. Separated only so each half stays readable. */
function decodeParsedVerdict(
  body: unknown,
  source: THookDefinition['type'],
  raw: string,
): THookOutcome {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return {
      outcome: 'error',
      source,
      kind: 'malformed-response',
      reason: `Hook response is not a JSON object: ${excerpt(raw)}`,
    };
  }

  const { ok, reason } = body as { ok?: unknown; reason?: unknown };

  if (ok === true) {
    return { outcome: 'allow', source, stdout: raw };
  }

  if (ok === false) {
    return {
      outcome: 'deny',
      source,
      reason: typeof reason === 'string' && reason ? reason : `Blocked by ${source} hook`,
    };
  }

  // Neither boolean, so the `{ ok }` verdict is undecodable. Before calling that "no verdict", ask
  // whether the SAME body carries an explicit block directive — `continue: false`,
  // `decision: "block"`, `permissionDecision: "deny"`. Those are unambiguous statements the hook
  // made outright, and an endpoint that wrote `{"ok": "false", "continue": false}` plainly meant to
  // block. Discarding that because `ok` was a string would be fail-open in an enforcement gate: the
  // same class of defect as reading the string as approval, pointed the other way.
  const directive = explicitBlockDirective(body);
  if (directive !== null) {
    return { outcome: 'deny', source, reason: directive };
  }

  // Nothing in the body decided anything. Deliberately NOT folded into either verdict.
  return {
    outcome: 'error',
    source,
    kind: 'malformed-response',
    reason:
      ok === undefined
        ? `Hook response has no boolean "ok" field: ${excerpt(raw)}`
        : `Hook response "ok" is ${typeof ok}, not boolean: ${excerpt(raw)}`,
  };
}
