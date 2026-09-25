/**
 * What counts as a secret in an MCP definition — one principle for every consumer.
 *
 * A value is secret because of what it is, not because of which field carries it: a stretch that a
 * credential-shaped variable produced is secret wherever it lands, and a value under a
 * credential-shaped env or header key is secret as a whole, because a literal credential has no
 * variable to trace. The fingerprint, the activation endpoint and the projections all read this.
 */

import type { IMCPServerDefinitionResolved } from './types.js';

/** Name segments that mark a credential, matched whole — so `KEYBOARD` and `AUTHOR` are not. */
const CREDENTIAL_SEGMENTS: ReadonlySet<string> = new Set([
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSWD',
  'PWD',
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

/**
 * Endings that mark a credential inside a compound segment: `PGPASSWORD`, `ACCESSTOKEN`, and a
 * camelCase key such as `accessToken`, which is one segment once uppercased.
 */
const CREDENTIAL_SUFFIXES: readonly string[] = [
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSWD',
  'APIKEY',
  'ACCESSKEY',
  'PRIVATEKEY',
  'CONNECTIONSTRING',
];

/** Names that carry a credential without saying so: connection strings embed one. */
const CREDENTIAL_NAMES: ReadonlySet<string> = new Set([
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRESQL_URL',
  'MYSQL_URL',
  'REDIS_URL',
  'MONGODB_URI',
  'MONGODB_URL',
  'MONGO_URI',
  'MONGO_URL',
  'AMQP_URL',
  'RABBITMQ_URL',
]);

/** The shell's own directory variables, which a `PWD` segment would otherwise catch. */
const NOT_CREDENTIALS: ReadonlySet<string> = new Set(['PWD', 'OLDPWD']);

/** Whether a variable, env key or header name names a credential. Case-insensitive. */
export function isCredentialShapedName(name: string): boolean {
  const upper = name.toUpperCase();
  if (NOT_CREDENTIALS.has(upper)) return false;
  if (CREDENTIAL_NAMES.has(upper)) return true;
  const segments = upper.split(/[^A-Z0-9]+/).filter((segment) => segment.length > 0);
  if (segments.some((segment) => CREDENTIAL_SEGMENTS.has(segment))) return true;
  if (segments.some((segment) => CREDENTIAL_SUFFIXES.some((end) => segment.endsWith(end)))) {
    return true;
  }
  return segments.join('_').endsWith('CONNECTION_STRING');
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
 * `value`, as it may be printed or fingerprinted: each secret stretch replaced by a marker naming
 * the variable it came from. Under a credential-shaped key every stretch is secret — literal text
 * becomes {@link SECRET_LITERAL} and each expanded stretch still names its variable, so pointing a
 * key at a different credential is a different value. `field` is the value's path in
 * {@link IMCPServerDefinitionResolved.provenance}.
 */
export function withoutSecrets(
  definition: Pick<IMCPServerDefinitionResolved, 'provenance'>,
  field: string,
  value: string,
): string {
  const key = keyOf(field);
  const wholeValueSecret = key !== undefined && isCredentialShapedName(key);
  // Forward, in (start, end) order: two stretches can start at the same offset when one is empty.
  const spans = [...(definition.provenance?.[field] ?? [])].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
  let out = '';
  let cursor = 0;
  const literal = (text: string): string =>
    wholeValueSecret && text.length > 0 ? SECRET_LITERAL : text;
  for (const span of spans) {
    out += literal(value.slice(cursor, span.start));
    out +=
      span.secret || wholeValueSecret
        ? secretMarker(span.variable)
        : value.slice(span.start, span.end);
    cursor = span.end;
  }
  out += literal(value.slice(cursor));
  return wholeValueSecret && out.length === 0 ? SECRET_LITERAL : out;
}

/**
 * `value` with every stretch an environment reference produced put back as that reference, so
 * nothing the environment supplied appears in it — for handing a value to a program the definition's
 * author, not the user, chose.
 */
export function withoutExpansions(
  definition: Pick<IMCPServerDefinitionResolved, 'provenance'>,
  field: string,
  value: string,
): string {
  const spans = [...(definition.provenance?.[field] ?? [])].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    out += value.slice(cursor, span.start) + '${' + span.variable + '}';
    cursor = span.end;
  }
  return out + value.slice(cursor);
}
