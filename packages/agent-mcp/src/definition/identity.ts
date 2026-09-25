/**
 * Activation identity and fingerprint for a resolved definition (MCP-001).
 *
 * MCP-2520's admission service treats a changed `definitionFingerprint` or `securityIdentity` as
 * `stale` and refuses the activation until it is approved again. Until now nothing computed those
 * values from a definition — the caller passed whatever string it liked, so the invalidation was a
 * contract with no producer. This module is that producer.
 *
 * Two values, because they answer two questions:
 *
 * - `definitionFingerprint` covers every value that decides what runs or where it connects: the
 *   transport, command, arguments, requested cwd, url, every header and environment entry, the
 *   timeout, the header helper, and any authentication the definition declares but this version
 *   cannot perform. The helper is covered because its output is sent to the url: approving one
 *   pairing must not approve the helper's output going somewhere else, or another helper's
 *   output going there. Change any of it — a `NODE_OPTIONS` value included — and a prior approval no longer
 *   describes what would now run.
 * - `securityIdentity` covers where the definition came from — its name, source and origin. Two
 *   entries that run the identical command are still different subjects for approval if one is a
 *   managed policy and the other is a plugin's.
 *
 * SECRET VALUES ARE NOT HASHED. What is secret is decided once, by `secrecy.ts`: a stretch a
 * credential-shaped variable produced, or a value under a credential-shaped key. Each is replaced
 * by a marker naming its source before hashing — a fingerprint travels into audit records and
 * approval stores, and a hash of a secret is still derived from it. So rotating a credential does
 * not invalidate an approval, which is correct — the operator approved the server, not the
 * credential — while a changed host around it still does.
 */

import { createHash } from 'node:crypto';

import { withoutSecrets } from './secrecy.js';

import type { IMCPResolvedEntry, IMCPServerDefinitionResolved } from './types.js';

/** Bumped when what the fingerprint covers changes, so no old value can match a new one. */
const FINGERPRINT_VERSION = 'v2';

function digest(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    // Length-prefixed, so ['ab','c'] and ['a','bc'] cannot collide.
    hash.update(String(part.length));
    hash.update(':');
    hash.update(part);
  }
  return hash.digest('hex').slice(0, 32);
}

/**
 * A list as its own length-prefixed parts, preceded by its element count.
 *
 * NOT `join(separator)`. Review measured the collision that produces: `['a','b']` and
 * `['a\u0000b']` join to the same string, so an argument list of two arguments and one of a single
 * argument containing the separator fingerprinted identically — an approval bound to one would
 * silently cover the other. The per-part length prefix in `digest` separates PARTS, not the
 * elements inside one part; this makes each element a part.
 */
function listParts(label: string, values: readonly string[]): readonly string[] {
  return [label, String(values.length), ...values];
}

/** A record's entries as `key, value` parts in key order, each value with its secrets replaced. */
function entryParts(
  label: string,
  definition: IMCPServerDefinitionResolved,
  values: Readonly<Record<string, string>> | undefined,
): readonly string[] {
  const keys = Object.keys(values ?? {}).sort();
  return listParts(
    label,
    keys.flatMap((key) => [key, withoutSecrets(definition, `${label}.${key}`, values![key]!)]),
  );
}

/** What will run or be contacted, with no secret value in it. */
export function definitionFingerprint(definition: IMCPServerDefinitionResolved): string {
  const clean = (field: string, value: string | undefined): string =>
    value === undefined ? '' : withoutSecrets(definition, field, value);
  return digest([
    FINGERPRINT_VERSION,
    'transport',
    definition.transport,
    'command',
    clean('command', definition.command),
    ...listParts(
      'args',
      (definition.args ?? []).map((arg, index) => clean(`args[${index}]`, arg)),
    ),
    'cwd',
    clean('cwd', definition.cwd),
    'url',
    clean('url', definition.url),
    ...entryParts('headers', definition, definition.headers),
    ...entryParts('env', definition, definition.env),
    'timeout',
    definition.timeout === undefined ? '' : String(definition.timeout),
    // Only when declared, so every definition without them keeps the fingerprint it had.
    ...(definition.headersHelper === undefined
      ? []
      : [
          'headersHelper',
          definition.headersHelper.command,
          ...listParts('headersHelperArgs', definition.headersHelper.args),
        ]),
    ...(definition.unsupportedAuthentication === undefined
      ? []
      : listParts('unsupportedAuthentication', definition.unsupportedAuthentication)),
  ]);
}

/** Characters an argument may show unquoted: nothing that could hide a boundary or a character. */
const PLAIN_ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/;
/** What JSON leaves unescaped but a terminal would act on or hide: C1 controls, format characters. */
const INVISIBLE = /[\u007f-\u009f\u2028\u2029\p{Cf}]/gu;

/**
 * One argv element as an approver reads it. An element needing quotes is shown as a JSON string
 * with every control and format character escaped, so `["a b"]` and `["a", "b"]` read differently
 * and nothing in an argument can rewrite the text around it.
 */
function displayArgument(part: string): string {
  if (PLAIN_ARGUMENT.test(part)) return part;
  return JSON.stringify(part).replace(
    INVISIBLE,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/**
 * The endpoint an activation names: the URL, or for stdio the command line — each with its secret
 * stretches replaced, because it lands in activation requests and audit records. A URL whose
 * headers come from a helper names the helper beside it, so whoever approves sees where the
 * helper's output is sent. One function, so the registry that builds a request and the transport
 * that re-checks it agree.
 */
export function activationEndpoint(definition: IMCPServerDefinitionResolved): string {
  if (definition.url !== undefined) {
    const url = withoutSecrets(definition, 'url', definition.url);
    const helper = definition.headersHelper;
    if (helper === undefined) return url;
    return `${url} (headers from ${[helper.command, ...helper.args].map(displayArgument).join(' ')})`;
  }
  const command =
    definition.command === undefined
      ? ''
      : withoutSecrets(definition, 'command', definition.command);
  const args = (definition.args ?? []).map((arg, index) =>
    withoutSecrets(definition, `args[${index}]`, arg),
  );
  return [command, ...args].join(' ').trim();
}

/** Which configured subject this is — name, source, origin. */
export function securityIdentity(entry: IMCPResolvedEntry): string {
  return digest(['name', entry.name, 'source', entry.source, 'origin', entry.origin]);
}

export interface IMCPActivationIdentity {
  readonly serverId: string;
  readonly definitionFingerprint: string;
  readonly securityIdentity: string;
}

/**
 * The identity an activation request for this entry must carry.
 *
 * An `unresolved` entry has no definition, so there is nothing to activate and nothing to
 * fingerprint; returning `null` keeps the caller from inventing an identity for a server it could
 * not read.
 */
export function activationIdentity(entry: IMCPResolvedEntry): IMCPActivationIdentity | null {
  if (entry.definition === undefined) return null;
  return {
    serverId: entry.name,
    definitionFingerprint: definitionFingerprint(entry.definition),
    securityIdentity: securityIdentity(entry),
  };
}
