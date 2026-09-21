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
 * - `definitionFingerprint` covers the transport, command, arguments, url, header and environment
 *   KEYS, and the timeout. Change any of it and a prior approval no longer describes what would now
 *   run.
 *   Contained — SECURITY-2793 (issue #2793): it does NOT cover env/header VALUES, so an approved
 *   server whose `NODE_OPTIONS` value changes keeps its fingerprint while what it loads changes.
 *   An earlier version of this comment claimed the fingerprint covered "everything that decides
 *   what will be executed", which was false in exactly that case.
 * - `securityIdentity` covers where the definition came from — its name, source and origin. Two
 *   entries that run the identical command are still different subjects for approval if one is a
 *   managed policy and the other is a plugin's.
 *
 * SECRET VALUES ARE NOT HASHED. `env` and `headers` contribute their keys, never their values: a
 * fingerprint travels into audit records and approval stores, and a hash of a secret is still
 * derived from it. The cost is that rotating a token's VALUE does not invalidate an approval, which
 * is correct — the operator approved the server, not the credential.
 */

import { createHash } from 'node:crypto';

import type { IMCPResolvedEntry, IMCPServerDefinitionResolved } from './types.js';

function digest(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    // Length-prefixed, so ['ab','c'] and ['a','bc'] cannot collide. The joins below use the
    // ESCAPE `'\u0000'` rather than a literal NUL byte. A literal one makes git classify this
    // file as binary, which hides the whole module from the diff, from `git blame`, and from
    // every ripgrep/grep-based check a reviewer or a scan runs. Same bytes hashed, visible source.
    hash.update(String(part.length));
    hash.update(':');
    hash.update(part);
  }
  return hash.digest('hex').slice(0, 32);
}

/** What will run or be contacted, with no secret value in it. */
export function definitionFingerprint(definition: IMCPServerDefinitionResolved): string {
  return digest([
    'transport',
    definition.transport,
    'command',
    definition.command ?? '',
    'args',
    (definition.args ?? []).join('\u0000'),
    'url',
    definition.url ?? '',
    'headerKeys',
    Object.keys(definition.headers ?? {})
      .sort()
      .join('\u0000'),
    'envKeys',
    Object.keys(definition.env ?? {})
      .sort()
      .join('\u0000'),
    'timeout',
    definition.timeout === undefined ? '' : String(definition.timeout),
  ]);
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
