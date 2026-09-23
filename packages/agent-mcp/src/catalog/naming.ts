/**
 * Canonical tool/prompt/resource naming for the MCP catalog (MCP-002).
 *
 * A canonical name is `<server>__<source>`, sanitised to `[A-Za-z0-9_-]` and budgeted to
 * {@link MCP_CANONICAL_NAME_BUDGET}. This module owns both halves of that contract: producing one
 * name deterministically (`canonicalName`) and resolving what happens when two distinct sources
 * land on the same name after sanitisation or truncation (`resolveNameCollisions`).
 */

import { createHash } from 'node:crypto';

import { MCP_CANONICAL_NAME_BUDGET } from './types.js';

import type { TMCPCanonicalName } from './types.js';

/** Everything outside the exposed-name alphabet becomes `_`. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g;

/** Length of the stable disambiguating hash appended when a name must be truncated. */
const TRUNCATION_HASH_LENGTH = 8;

/** Joins the head/tail halves of a middle-truncated name, and separates each from the hash. */
const TRUNCATION_JOINER = '~';

export interface ICanonicalNameResult {
  readonly name: TMCPCanonicalName;
  /** True when sanitising or truncating changed the natural `<server>__<source>` form. */
  readonly changed: boolean;
  /** Present only when `changed` is true: `'renamed'`, `'truncated'`, or `'renamed, truncated'`. */
  readonly reason?: string;
}

function sanitise(part: string): string {
  return part.replace(INVALID_NAME_CHARS, '_');
}

function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, TRUNCATION_HASH_LENGTH);
}

/**
 * Middle-truncates `name` to at most `budget` characters, deterministically: same input always
 * produces the same output, and a short stable hash of the FULL (pre-truncation) name is folded
 * in so two distinct long names that happen to share a head and tail still diverge.
 */
function truncateDeterministically(name: string, budget: number): string {
  const hash = shortHash(name);
  const fixedLength = hash.length + TRUNCATION_JOINER.length * 2;

  if (budget <= fixedLength) {
    // No room for any head/tail material at all; the hash alone (itself truncated to the budget)
    // is still deterministic and still distinguishes distinct inputs whenever the budget allows.
    return hash.slice(0, Math.max(budget, 0));
  }

  const remaining = budget - fixedLength;
  const headLength = Math.ceil(remaining / 2);
  const tailLength = remaining - headLength;
  const head = name.slice(0, headLength);
  const tail = tailLength > 0 ? name.slice(name.length - tailLength) : '';

  return `${head}${TRUNCATION_JOINER}${hash}${TRUNCATION_JOINER}${tail}`;
}

/**
 * Builds the canonical exposed name for one server-scoped item.
 *
 * The prefix is unconditional — every name is `<server>__<source>` before anything else happens —
 * and every character outside `[A-Za-z0-9_-]` in EITHER part is sanitised to `_` before the budget
 * is even considered, so sanitisation and truncation compose rather than race.
 */
export function canonicalName(
  serverId: string,
  sourceName: string,
  budget: number = MCP_CANONICAL_NAME_BUDGET,
): ICanonicalNameResult {
  const natural = `${serverId}__${sourceName}`;
  const sanitisedNatural = `${sanitise(serverId)}__${sanitise(sourceName)}`;
  const wasSanitised = sanitisedNatural !== natural;

  if (sanitisedNatural.length <= budget) {
    return wasSanitised
      ? { name: sanitisedNatural, changed: true, reason: 'renamed' }
      : { name: sanitisedNatural, changed: false };
  }

  return {
    name: truncateDeterministically(sanitisedNatural, budget),
    changed: true,
    reason: wasSanitised ? 'renamed, truncated' : 'truncated',
  };
}

export interface INameCollisionCandidate {
  readonly key: string;
  readonly name: string;
}

export interface INameCollisionLoser {
  readonly key: string;
  readonly name: string;
  readonly reason: string;
}

export interface INameCollisionResolution {
  /** Candidate key → the exposed name it keeps. */
  readonly winners: Map<string, string>;
  readonly losers: readonly INameCollisionLoser[];
}

/**
 * Deterministically resolves candidates that landed on the same exposed name.
 *
 * Candidates are sorted by `key` (ascending, ordinary string order); the first candidate to reach
 * a given name keeps it, and every later candidate reaching the same name is a loser recording
 * which winner it collided with. Sorting by `key` — rather than by input order — is what makes the
 * outcome independent of how the caller happened to enumerate servers and domains.
 */
export function resolveNameCollisions(
  candidates: readonly INameCollisionCandidate[],
): INameCollisionResolution {
  const sorted = [...candidates].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const winners = new Map<string, string>();
  const nameOwner = new Map<string, string>();
  const losers: INameCollisionLoser[] = [];

  for (const candidate of sorted) {
    const owner = nameOwner.get(candidate.name);
    if (owner === undefined) {
      nameOwner.set(candidate.name, candidate.key);
      winners.set(candidate.key, candidate.name);
      continue;
    }
    losers.push({
      key: candidate.key,
      name: candidate.name,
      reason: `collides with ${owner} after sanitisation/truncation`,
    });
  }

  return { winners, losers };
}
