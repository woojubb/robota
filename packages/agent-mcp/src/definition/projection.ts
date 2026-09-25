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
import { displayArgs, displayValue, maskCredentials } from './secrecy.js';

import type {
  IMCPOAuthConfig,
  IMCPResolvedEntry,
  TMCPDefinitionSource,
  TMCPTransport,
} from './types.js';

export const REDACTED = '[REDACTED]';

/**
 * A definition as it may be shown, with `env` and `headers` VALUES redacted.
 *
 * Command, args, cwd and url stay readable with every secret stretch replaced — what a
 * credential-shaped variable expanded into them, and any literal that has a credential's shape.
 */
export interface IMCPDefinitionProjection {
  readonly name: string;
  readonly source: TMCPDefinitionSource;
  readonly origin: string;
  readonly status: 'resolved' | 'unresolved';
  readonly transport?: TMCPTransport;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  /** Every value is `[REDACTED]`; the keys are the information. */
  readonly env?: Readonly<Record<string, string>>;
  readonly url?: string;
  /** Every value is `[REDACTED]`; the keys are the information. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeout?: number;
  /** OAuth sign-in settings; none of them is a secret. */
  readonly oauth?: IMCPOAuthConfig;
  /** Declared authentication this version cannot perform; the server is listed but not connected. */
  readonly unsupportedAuthentication?: readonly string[];
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
 * `url` and the command line stay readable: they are what the operator tells two servers apart by.
 * Only their secret stretches are replaced — what a credential-shaped variable expanded into them,
 * and literals that look like credentials (a URL password, a credential-named query parameter or
 * flag value, a known token format, a long high-entropy run).
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
    if (definition.command !== undefined) {
      projection.command = displayValue(definition, 'command', definition.command);
    }
    if (definition.args !== undefined) projection.args = displayArgs(definition, definition.args);
    if (definition.cwd !== undefined)
      projection.cwd = displayValue(definition, 'cwd', definition.cwd);
    if (definition.env !== undefined) projection.env = redactValues(definition.env);
    if (definition.url !== undefined)
      projection.url = displayValue(definition, 'url', definition.url);
    if (definition.headers !== undefined) projection.headers = redactValues(definition.headers);
    if (definition.timeout !== undefined) projection.timeout = definition.timeout;
    if (definition.oauth !== undefined) {
      const { clientId, authServerMetadataUrl } = definition.oauth;
      projection.oauth = {
        ...definition.oauth,
        ...(clientId === undefined ? {} : { clientId: maskCredentials(clientId) }),
        ...(authServerMetadataUrl === undefined
          ? {}
          : { authServerMetadataUrl: maskCredentials(authServerMetadataUrl) }),
      };
    }
    if (definition.unsupportedAuthentication !== undefined) {
      projection.unsupportedAuthentication = [...definition.unsupportedAuthentication];
    }
  }

  return projection;
}

/** Project a whole resolved set. */
export function projectEntries(
  entries: readonly IMCPResolvedEntry[],
): readonly IMCPDefinitionProjection[] {
  return entries.map(projectEntry);
}
