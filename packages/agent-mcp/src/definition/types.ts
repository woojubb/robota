/**
 * MCP server definitions — the raw, validated and resolved forms (MCP-001).
 *
 * `agent-mcp` is the sole owner of these shapes (ADR-005). Nothing here performs I/O: a definition
 * is data about a server, not a connection to one, and the separation is what lets configuration be
 * inspected — listed, diffed, approved — before anything is contacted.
 */

import type { TMCPActivationSource } from '../mcp-activation.js';

/**
 * Where a definition came from. Ordered by precedence in `precedence.ts`, not here.
 *
 * This is the activation union, not a copy of it. A second five-member union spelled out here
 * compiled against the first by coincidence, so `registry.ts` needed an assertion to bridge them
 * and that assertion would have kept compiling through a divergence — into
 * `requiresTrustedWorkspace`, which returns `false` for an unrecognised source and so routes it to
 * the LESS restrictive path. One declaration cannot diverge from itself.
 */
export type TMCPDefinitionSource = TMCPActivationSource;

/**
 * The transports a definition can name.
 *
 * `streamable-http` is accepted on input as an alias of `http` and normalised away, so downstream
 * code compares one spelling. Naming a transport is not the same as having one: MCP-002 owns the
 * clients, and MCP-2522 owns stdio execution.
 */
export type TMCPTransport = 'stdio' | 'http' | 'sse' | 'ws';

/** An entry exactly as it was read, before any validation or materialization. */
export interface IMCPServerDefinitionRaw {
  readonly name: string;
  readonly source: TMCPDefinitionSource;
  /** The origin the entry was read from — a file path, a plugin id, a policy name. */
  readonly origin: string;
  /** The entry body, untouched. Unknown keys are preserved so a refusal can name them. */
  readonly entry: Readonly<Record<string, unknown>>;
}

/** A raw entry that decoded cleanly. Environment templates are NOT yet materialized. */
export interface IMCPServerDefinition {
  readonly name: string;
  readonly source: TMCPDefinitionSource;
  readonly origin: string;
  readonly transport: TMCPTransport;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeout?: number;
}

/** An environment reference that could not be materialized, reported rather than guessed at. */
export interface IMCPUnsetVariable {
  /** The variable name inside the reference, e.g. `MISSING_TOKEN` for `${MISSING_TOKEN}`. */
  readonly variable: string;
  /** The field the reference appeared in, e.g. `url`, `env.API_KEY`, `args[1]`. */
  readonly field: string;
  /** The literal text left in place, e.g. `${MISSING_TOKEN}`. */
  readonly literal: string;
}

/** A definition whose templates were materialized. Still no connection has been made. */
export interface IMCPServerDefinitionResolved extends IMCPServerDefinition {
  /** Empty when every reference had a value or a default. */
  readonly unsetVariables: readonly IMCPUnsetVariable[];
}

/** Why a name could not produce a usable definition. The name is always known; the rest may not be. */
export interface IMCPDefinitionProblem {
  readonly name: string;
  readonly source: TMCPDefinitionSource;
  readonly origin: string;
  readonly reason: string;
}

/** An entry a winner hid. Recorded so a hidden definition is visible rather than absent. */
export interface IMCPDefinitionShadow {
  readonly name: string;
  readonly source: TMCPDefinitionSource;
  readonly origin: string;
}

/**
 * One server name's outcome.
 *
 * `unresolved` carries a `problem` and no `definition` — and it still carries its `shadowed` list.
 * A malformed higher-precedence entry does not hand the name to a lower one (ADR-005): a broken
 * managed policy must not be silently replaced by a plugin's definition.
 */
export interface IMCPResolvedEntry {
  readonly name: string;
  readonly source: TMCPDefinitionSource;
  readonly origin: string;
  readonly status: 'resolved' | 'unresolved';
  readonly definition?: IMCPServerDefinitionResolved;
  readonly problem?: IMCPDefinitionProblem;
  readonly shadowed: readonly IMCPDefinitionShadow[];
  /** Set by the disable overlay; absent means enabled. */
  readonly disabledReason?: string;
}
