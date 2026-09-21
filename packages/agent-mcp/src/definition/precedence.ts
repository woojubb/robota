/**
 * Whole-entry precedence resolution (MCP-001).
 *
 * Two properties carry the weight here, and both are ADR-005's:
 *
 * 1. **Entries are never field-merged.** The winning source supplies the whole definition. Merging
 *    would let a lower-trust source contribute a field — an extra header, a different `command` —
 *    to an entry the operator believes came from a managed policy.
 * 2. **A malformed winner still shadows.** If the highest-precedence entry for a name cannot be
 *    decoded, the name resolves to `unresolved`; it does NOT fall through to the next source. Fall-
 *    through would mean a broken managed policy silently hands the name to a plugin — failing open
 *    in exactly the case where the operator most needs it to fail closed.
 */

import type {
  IMCPDefinitionProblem,
  IMCPDefinitionShadow,
  IMCPResolvedEntry,
  IMCPServerDefinition,
  IMCPServerDefinitionResolved,
  TMCPDefinitionSource,
} from './types.js';

/**
 * Highest first.
 *
 * This order is ARCH-1985's and ADR-005's, pinned there by a mechanical assertion. The current
 * official Claude Code documentation places plugin-provided servers above user scope instead; that
 * divergence is recorded as issue #2790 and is deliberately NOT resolved by editing this array.
 */
export const MCP_SOURCE_PRECEDENCE: readonly TMCPDefinitionSource[] = [
  'managed',
  'local',
  'project',
  'user',
  'plugin',
];

const RANK: ReadonlyMap<TMCPDefinitionSource, number> = new Map(
  MCP_SOURCE_PRECEDENCE.map((source, index) => [source, index]),
);

/** One source's decode output, as `decodeSource` returns it, tagged with where it came from. */
export interface IMCPSourceCandidates {
  readonly source: TMCPDefinitionSource;
  readonly origin: string;
  readonly definitions: readonly IMCPServerDefinition[];
  readonly problems: readonly IMCPDefinitionProblem[];
}

interface ICandidate {
  readonly source: TMCPDefinitionSource;
  readonly origin: string;
  readonly definition?: IMCPServerDefinition;
  readonly problem?: IMCPDefinitionProblem;
}

function rankOf(source: TMCPDefinitionSource): number {
  return RANK.get(source) ?? MCP_SOURCE_PRECEDENCE.length;
}

/**
 * Resolve every server name across the supplied sources.
 *
 * `materialize` is injected rather than imported so this module stays about ORDER. The caller
 * passes `materializeDefinition` bound to its environment; a test can pass an identity function and
 * assert precedence without reasoning about templates at the same time.
 */
export function resolveByPrecedence(
  sources: readonly IMCPSourceCandidates[],
  materialize: (definition: IMCPServerDefinition) => IMCPServerDefinitionResolved,
): readonly IMCPResolvedEntry[] {
  const byName = new Map<string, ICandidate[]>();

  const add = (name: string, candidate: ICandidate): void => {
    const list = byName.get(name);
    if (list) list.push(candidate);
    else byName.set(name, [candidate]);
  };

  for (const source of sources) {
    for (const definition of source.definitions) {
      add(definition.name, { source: source.source, origin: definition.origin, definition });
    }
    for (const problem of source.problems) {
      // A container-level problem has no name — it cannot shadow or be shadowed by a named entry,
      // so it is not a candidate for any name. The caller still receives it through `problems`.
      if (problem.name === '') continue;
      add(problem.name, { source: source.source, origin: problem.origin, problem });
    }
  }

  const entries: IMCPResolvedEntry[] = [];
  for (const [name, candidates] of byName) {
    const ordered = [...candidates].sort((a, b) => rankOf(a.source) - rankOf(b.source));
    const winner = ordered[0];
    if (winner === undefined) continue;
    const shadowed: IMCPDefinitionShadow[] = ordered
      .slice(1)
      .map((candidate) => ({ name, source: candidate.source, origin: candidate.origin }));

    if (winner.definition !== undefined) {
      entries.push({
        name,
        source: winner.source,
        origin: winner.origin,
        status: 'resolved',
        definition: materialize(winner.definition),
        shadowed,
      });
      continue;
    }

    entries.push({
      name,
      source: winner.source,
      origin: winner.origin,
      status: 'unresolved',
      ...(winner.problem === undefined ? {} : { problem: winner.problem }),
      shadowed,
    });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}
