/**
 * Whole-entry precedence resolution (MCP-001).
 *
 * Three properties carry the weight here, and all three are ADR-005's:
 *
 * 1. **Entries are never field-merged.** The winning source supplies the whole definition. Merging
 *    would let a lower-trust source contribute a field — an extra header, a different `command` —
 *    to an entry the operator believes came from a managed policy.
 * 2. **A malformed winner still shadows.** If the highest-precedence entry for a name cannot be
 *    decoded, the name resolves to `unresolved`; it does NOT fall through to the next source. Fall-
 *    through would mean a broken managed policy silently hands the name to a plugin — failing open
 *    in exactly the case where the operator most needs it to fail closed.
 * 3. **A source-level failure in the managed tier blocks every LOWER tier, not just names managed
 *    also declares.** When the managed source could not be read AT ALL (issue #2794's
 *    `sourceProblems`), there is no way to tell "managed defines nothing" from "managed defines this
 *    exact name and we cannot see it" — so a name that would otherwise resolve from local, project,
 *    user or plugin is blocked instead. A name that already resolved from a DIFFERENT, readable
 *    managed origin is unaffected (a broken source-level origin contributes zero definitions, so it
 *    cannot be the thing that actually won). A source-level failure in any OTHER tier carries no
 *    such ambiguity for a higher-trust source and stays informational: everything else still
 *    resolves.
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
 * Everything one call to `resolveByPrecedence` produced: the per-name resolution `IMCPResolvedEntry`
 * already carried, plus every problem that named no server at all.
 *
 * A source-level problem (`IMCPDefinitionProblem` with `name === ''`) is the SAME problem type a
 * server-level entry carries — one type, one scope field distinguishes them — but it cannot become
 * an `IMCPResolvedEntry` because that shape is keyed by server name. `sourceProblems` is that
 * problem's carrier: without it, an entirely unreadable managed policy (config root not an object,
 * no `mcpServers`, `mcpServers` not an object) vanished with a `continue` and reached
 * `statusOf`/`listServers` as if nothing had gone wrong (issue #2794).
 *
 * A source problem in the HIGHEST-precedence tier (`MCP_SOURCE_PRECEDENCE[0]`, `managed`) also
 * changes `entries`, not just `sourceProblems`: every name that would otherwise resolve from a
 * LOWER-trust source is blocked instead (see `resolveByPrecedence`'s doc). A source problem in any
 * other tier is purely informational — it sits beside `entries`, and every other source still
 * resolves exactly as if it were absent.
 */
export interface IMCPPrecedenceResult {
  readonly entries: readonly IMCPResolvedEntry[];
  /** Every problem with `name === ''` across all sources, in source order. Never filtered by rank. */
  readonly sourceProblems: readonly IMCPDefinitionProblem[];
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
): IMCPPrecedenceResult {
  const byName = new Map<string, ICandidate[]>();
  const sourceProblems: IMCPDefinitionProblem[] = [];

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
      // so it is not a candidate for any name. It still needs a carrier, though (issue #2794): it
      // is collected into `sourceProblems` rather than dropped, so a caller building `statusOf`/
      // `listServers` from this result can say which source could not be read at all.
      if (problem.name === '') {
        sourceProblems.push(problem);
        continue;
      }
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

  const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));

  // Fail closed on the managed tier (ADR-005, extended by issue #2794): while the highest-precedence
  // source could not be read at all, a name that resolved from a LOWER tier must not activate,
  // because the unreadable managed source might have defined that exact name and there is no way to
  // tell. Only `MCP_SOURCE_PRECEDENCE[0]` triggers this; a source problem anywhere else stays
  // informational (`sourceProblems` alone), because a broken LOWER-trust source can never hide a
  // HIGHER-trust one.
  //
  // An entry that ALREADY resolved from the managed tier itself (from a different, READABLE managed
  // origin than the broken one) is left alone: a source-level problem means that origin contributed
  // ZERO definitions (`decodeSource`'s contract — the whole container failed, not one entry), so it
  // cannot be the thing that actually won this name, and there is no ambiguity left to fail closed
  // over for a name managed already answered.
  const managedTier = MCP_SOURCE_PRECEDENCE[0];
  const blockingProblem = sourceProblems.find((problem) => problem.source === managedTier);
  if (blockingProblem === undefined) {
    return { entries: sorted, sourceProblems };
  }

  const blocked = sorted.map((entry): IMCPResolvedEntry => {
    if (entry.status !== 'resolved' || entry.source === managedTier) return entry;
    return {
      name: entry.name,
      source: entry.source,
      origin: entry.origin,
      status: 'unresolved',
      problem: {
        name: entry.name,
        source: entry.source,
        origin: entry.origin,
        reason:
          `blocked: the ${managedTier} source (${blockingProblem.origin}) could not be read ` +
          `(${blockingProblem.reason}), so a lower-trust definition cannot be trusted to be the ` +
          'real winner',
      },
      shadowed: entry.shadowed,
    };
  });

  return { entries: blocked, sourceProblems };
}
