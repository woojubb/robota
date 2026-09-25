/**
 * Pure management results — list, get, status (MCP-001).
 *
 * These are RESULTS, not effects. Every function here takes an already-resolved set and returns a
 * value; none reads a file, opens a socket, or spawns a process. That is what lets `/mcp status`
 * answer "what is configured and from where" without deciding to contact anything, which is the
 * separation the SPEC requires between definition inspection and activation.
 *
 * `get` on an unknown name returns a typed not-found rather than throwing. A caller rendering a
 * command result wants to print "no such server, here are the names" — an exception makes that the
 * caller's job to reconstruct, and a thrown error in a listing path tends to become a crash report
 * where a sentence would do.
 */

import { projectEntries, projectEntry } from '../definition/projection.js';

import type { IMCPDefinitionProjection } from '../definition/projection.js';
import type { IMCPDefinitionProblem, IMCPResolvedEntry } from '../definition/types.js';

/**
 * A problem that named no server at all — `resolveByPrecedence`'s `sourceProblems` (issue #2794):
 * the configuration root was not an object, declared no `mcpServers`, `mcpServers` was not an
 * object, or the source itself could not be read. Reported beside `servers` rather than folded into
 * one of them, because it belongs to no server name.
 */
export interface IMCPListResult {
  readonly servers: readonly IMCPDefinitionProjection[];
  readonly sourceProblems: readonly IMCPDefinitionProblem[];
}

export type TMCPGetResult =
  | { readonly found: true; readonly server: IMCPDefinitionProjection }
  | { readonly found: false; readonly name: string; readonly knownNames: readonly string[] };

export interface IMCPStatusResult {
  readonly total: number;
  readonly resolved: number;
  readonly unresolved: number;
  readonly disabled: number;
  /** Server names with at least one unset environment reference, for the warning line. */
  readonly withUnsetVariables: readonly string[];
  readonly servers: readonly IMCPDefinitionProjection[];
  /** See {@link IMCPListResult.sourceProblems}. A managed source failing to read at all lands here,
   * never as a silent drop to `{total: 0}`. */
  readonly sourceProblems: readonly IMCPDefinitionProblem[];
}

/** Every configured server, projected, plus any problem that could not name one. */
export function listServers(
  entries: readonly IMCPResolvedEntry[],
  sourceProblems: readonly IMCPDefinitionProblem[] = [],
): IMCPListResult {
  return { servers: projectEntries(entries), sourceProblems };
}

/** One server by name, or a typed not-found carrying the names that do exist. */
export function getServer(entries: readonly IMCPResolvedEntry[], name: string): TMCPGetResult {
  const entry = entries.find((candidate) => candidate.name === name);
  if (entry === undefined) {
    return { found: false, name, knownNames: entries.map((candidate) => candidate.name) };
  }
  return { found: true, server: projectEntry(entry) };
}

/** Counts plus the projected set — what a status view needs in one pass. */
export function statusOf(
  entries: readonly IMCPResolvedEntry[],
  sourceProblems: readonly IMCPDefinitionProblem[] = [],
): IMCPStatusResult {
  const servers = projectEntries(entries);
  return {
    total: servers.length,
    resolved: servers.filter((server) => server.status === 'resolved').length,
    unresolved: servers.filter((server) => server.status === 'unresolved').length,
    disabled: servers.filter((server) => server.disabled).length,
    withUnsetVariables: servers
      .filter((server) => server.unsetVariables.length > 0)
      .map((server) => server.name),
    servers,
    sourceProblems,
  };
}
