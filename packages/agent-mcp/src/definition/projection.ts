/**
 * Redacted management projections (MCP-001).
 *
 * A projection is what leaves this package for a command, a log, or a screen. `env` and `headers`
 * VALUES never appear in one; their KEYS do.
 *
 * Keeping the keys is the point rather than an oversight. `Authorization: [REDACTED]` tells the
 * operator the header is configured, which is the question they are asking; dropping the key
 * entirely would make a server with a misspelled `Authorisation` look identical to one with no
 * header at all. Redaction is about the secret, not about the shape.
 */

import { isDisabled } from './overlay.js';

import type { IMCPResolvedEntry, TMCPDefinitionSource, TMCPTransport } from './types.js';

export const REDACTED = '[REDACTED]';

/**
 * A definition as it may be shown, with `env` and `headers` VALUES redacted.
 *
 * Contained — SECURITY-2793. This type said "secret-free by construction, not by the caller
 * remembering", and that is not true today: `command` and `args` are materialized from the same
 * environment map and are copied through verbatim, so `args: ['--header', 'Authorization: Bearer
 * ${TOKEN}']` carries the expanded token into every projection. The claim is narrowed to what the
 * code actually does rather than left standing; the fix needs value provenance out of
 * materialization, which SECURITY-2793 owns (issue #2793).
 */
export interface IMCPDefinitionProjection {
  readonly name: string;
  readonly source: TMCPDefinitionSource;
  readonly origin: string;
  readonly status: 'resolved' | 'unresolved';
  readonly transport?: TMCPTransport;
  readonly command?: string;
  readonly args?: readonly string[];
  /** Every value is `[REDACTED]`; the keys are the information. */
  readonly env?: Readonly<Record<string, string>>;
  readonly url?: string;
  /** Every value is `[REDACTED]`; the keys are the information. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeout?: number;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  /** Names of variables that had no value and no default; their references were left literal. */
  readonly unsetVariables: readonly string[];
  readonly shadowed: readonly { readonly source: TMCPDefinitionSource; readonly origin: string }[];
  readonly problem?: string;
}

function redactValues(record: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(record)) out[key] = REDACTED;
  return out;
}

/**
 * Project one resolved entry.
 *
 * `url` is carried through unredacted: it is the server's address, which the operator must be able
 * to read to tell two servers apart. A credential embedded in a URL is a separate, real hazard —
 * it is issue #2791, which refuses to expand credential-shaped variables into `url` and `headers`
 * in the first place, rather than redacting the whole address afterwards and hiding which server an
 * entry names.
 */
export function projectEntry(entry: IMCPResolvedEntry): IMCPDefinitionProjection {
  const definition = entry.definition;
  const projection: {
    -readonly [K in keyof IMCPDefinitionProjection]: IMCPDefinitionProjection[K];
  } = {
    name: entry.name,
    source: entry.source,
    origin: entry.origin,
    status: entry.status,
    disabled: isDisabled(entry),
    unsetVariables: definition?.unsetVariables.map((unset) => unset.variable) ?? [],
    shadowed: entry.shadowed.map((shadow) => ({ source: shadow.source, origin: shadow.origin })),
  };

  if (entry.disabledReason !== undefined) projection.disabledReason = entry.disabledReason;
  if (entry.problem !== undefined) projection.problem = entry.problem.reason;

  if (definition !== undefined) {
    projection.transport = definition.transport;
    if (definition.command !== undefined) projection.command = definition.command;
    if (definition.args !== undefined) projection.args = [...definition.args];
    if (definition.env !== undefined) projection.env = redactValues(definition.env);
    if (definition.url !== undefined) projection.url = definition.url;
    if (definition.headers !== undefined) projection.headers = redactValues(definition.headers);
    if (definition.timeout !== undefined) projection.timeout = definition.timeout;
  }

  return projection;
}

/** Project a whole resolved set. */
export function projectEntries(
  entries: readonly IMCPResolvedEntry[],
): readonly IMCPDefinitionProjection[] {
  return entries.map(projectEntry);
}
