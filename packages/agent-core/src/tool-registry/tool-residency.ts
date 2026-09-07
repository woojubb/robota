/**
 * Tool residency (CLI-1990): which registered schemas the model is offered.
 *
 * Three words, used consistently across the layers that read this module:
 *
 * - **resident** — a schema that does not declare `deferLoading`; always offered.
 * - **deferred** — declares `deferLoading: true`; withheld while deferral is engaged, until loaded.
 * - **offered** — what the next request carries: every registered tool while deferral is off, the
 *   resident ones plus the loaded deferred ones once it is on.
 *
 * Pure functions over schemas, beside the registry they describe. The STATE (which deferred tools
 * are loaded) belongs to the tool manager; the POLICY (whether deferral is engaged) belongs to the
 * agent, through `resolveToolSearchMode`. Neither is decided here.
 */

import type { IToolSchema } from '../interfaces/tool-schema';
import type { TToolSearchMode } from '../interfaces/tool-search';

/**
 * The vendor's own invariant, as a Robota-level error: a request in which every tool is withheld
 * offers the model nothing to call and nothing to search with.
 */
export const ALL_TOOLS_DEFERRED_MESSAGE =
  'at least one tool must stay resident; all tools cannot be deferred';

/** Whether a schema declares itself deferred. Omission means resident. */
export function isDeferredTool(schema: IToolSchema): boolean {
  return schema.deferLoading === true;
}

/**
 * The schemas a request carries. With deferral off this is the identity — the projection every
 * existing tool set takes, since nothing in today's tree declares `deferLoading`. With it on, a
 * non-empty set that projects to nothing is refused rather than sent: see the message above.
 */
export function projectOfferedTools(
  schemas: readonly IToolSchema[],
  loaded: ReadonlySet<string>,
  mode: TToolSearchMode,
): IToolSchema[] {
  if (mode === 'off') return [...schemas];
  const offered = schemas.filter((schema) => !isDeferredTool(schema) || loaded.has(schema.name));
  if (schemas.length > 0 && offered.length === 0) {
    throw new Error(ALL_TOOLS_DEFERRED_MESSAGE);
  }
  return offered;
}

/**
 * The same invariant at DECLARATION time, for an assembly that wants to fail at startup rather than
 * at the first request: a non-empty set in which every tool declares `deferLoading` is refused.
 */
export function assertResidentToolRemains(schemas: readonly IToolSchema[]): void {
  if (schemas.length > 0 && schemas.every(isDeferredTool)) {
    throw new Error(ALL_TOOLS_DEFERRED_MESSAGE);
  }
}
