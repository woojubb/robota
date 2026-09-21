/**
 * Pure management results — list, get, status (MCP-001).
 *
 * These are RESULTS, not effects. Every function here takes an already-resolved set and returns a
 * value; none reads a file, opens a socket, or spawns a process. That is what lets `/mcp status`
 * answer "what is configured and from where" without deciding to contact anything, which is the
 * separation ADR-005 requires between definition inspection and activation.
 *
 * `get` on an unknown name returns a typed not-found rather than throwing. A caller rendering a
 * command result wants to print "no such server, here are the names" — an exception makes that the
 * caller's job to reconstruct, and a thrown error in a listing path tends to become a crash report
 * where a sentence would do.
 */

import { projectEntries, projectEntry } from '../definition/projection.js';

import type { IMCPDefinitionProjection } from '../definition/projection.js';
import type { IMCPResolvedEntry } from '../definition/types.js';

export interface IMCPListResult {
  readonly servers: readonly IMCPDefinitionProjection[];
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
}

/** Every configured server, projected. */
export function listServers(entries: readonly IMCPResolvedEntry[]): IMCPListResult {
  return { servers: projectEntries(entries) };
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
export function statusOf(entries: readonly IMCPResolvedEntry[]): IMCPStatusResult {
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
  };
}
