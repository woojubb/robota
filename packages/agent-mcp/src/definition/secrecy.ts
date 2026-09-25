/**
 * What counts as a secret in an MCP definition — one principle for every consumer.
 *
 * A value is secret because of what it is, not because of which field carries it: a stretch that a
 * credential-shaped variable produced is secret wherever it lands, and a value under a
 * credential-shaped env or header key is secret as a whole, because a literal credential has no
 * variable to trace. The fingerprint, the activation endpoint and the projections all read this.
 */

import type { IMCPServerDefinitionResolved } from './types.js';

/** Name segments that mark a credential. Matched as whole segments, so `KEYBOARD` is not one. */
const CREDENTIAL_SEGMENTS: ReadonlySet<string> = new Set([
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSWD',
  'KEY',
  'APIKEY',
  'AUTH',
  'AUTHORIZATION',
  'CREDENTIAL',
  'CREDENTIALS',
  'PAT',
  'COOKIE',
  'PRIVATE',
  'DSN',
]);

/** Names that carry a credential without saying so. */
const CREDENTIAL_NAMES: ReadonlySet<string> = new Set(['DATABASE_URL']);

/** Whether a variable, env key or header name names a credential. Case-insensitive. */
export function isCredentialShapedName(name: string): boolean {
  const upper = name.toUpperCase();
  if (CREDENTIAL_NAMES.has(upper)) return true;
  return upper
    .split(/[^A-Z0-9]+/)
    .some((segment) => segment.length > 0 && CREDENTIAL_SEGMENTS.has(segment));
}

/** A secret expanded from a variable is shown as the variable it came from. */
export function secretMarker(variable: string): string {
  return `secret:${variable}`;
}

/** A value under a credential-shaped key, with no variable to name. */
export const SECRET_LITERAL = 'secret:literal';

function keyOf(field: string): string | undefined {
  const dot = field.indexOf('.');
  return dot === -1 ? undefined : field.slice(dot + 1);
}

/**
 * `value`, as it may be printed or fingerprinted: each secret stretch replaced by its marker, or the
 * whole value replaced when its key is credential-shaped. `field` is the value's path in
 * {@link IMCPServerDefinitionResolved.provenance}.
 */
export function withoutSecrets(
  definition: Pick<IMCPServerDefinitionResolved, 'provenance'>,
  field: string,
  value: string,
): string {
  const key = keyOf(field);
  if (key !== undefined && isCredentialShapedName(key)) return SECRET_LITERAL;
  const spans = (definition.provenance?.[field] ?? [])
    .filter((span) => span.secret)
    .sort((a, b) => b.start - a.start);
  let out = value;
  for (const span of spans) {
    out = out.slice(0, span.start) + secretMarker(span.variable) + out.slice(span.end);
  }
  return out;
}
