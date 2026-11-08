/**
 * What a `ToolSearch` query matches, and in what order (CLI-1990 § Solution 4).
 *
 * Pure functions over schemas, with no catalog and no tool-execution context, because the ranking is
 * the half worth testing on its own: given the same deferred set and the same query, the same tools
 * come back in the same order. The tool module beside this one owns the I/O — reading the catalog
 * port, loading what matched, shaping the result.
 *
 * The match surface is the reference's own: a tool's name, its description, and its parameters'
 * names and descriptions. An exact name is therefore a valid query, which is what lets a model that
 * already knows what it wants ask for it without a `names` argument.
 */

import type { IParameterSchema, IToolSchema } from '@robota-sdk/agent-core';

/** Both vendors default a tool search to five results; so does this one. */
export const DEFAULT_TOOL_SEARCH_LIMIT = 5;

/**
 * Where a query matched, lowest first — the primary sort key.
 *
 * A tool whose NAME the query names is a better answer than one that merely mentions it in a
 * parameter description, and saying so is what makes "the top five" meaningful once a catalog is
 * large enough for the limit to bite.
 */
const RANK_EXACT_NAME = 0;
const RANK_NAME = 1;
const RANK_DESCRIPTION = 2;
const RANK_PARAMETER = 3;
/** Not a match at all — filtered out rather than ranked last. */
const RANK_NONE = Number.POSITIVE_INFINITY;

/** Every parameter name and description in a schema, including nested nodes. */
function collectParameterText(node: IParameterSchema, into: string[]): void {
  if (node.description !== undefined) into.push(node.description);
  for (const [name, child] of Object.entries(node.properties ?? {})) {
    into.push(name);
    collectParameterText(child, into);
  }
  if (node.items !== undefined) collectParameterText(node.items, into);
  for (const branch of node.anyOf ?? []) collectParameterText(branch, into);
}

function rankMatch(schema: IToolSchema, query: string): number {
  const name = schema.name.toLowerCase();
  if (name === query) return RANK_EXACT_NAME;
  if (name.includes(query)) return RANK_NAME;
  if (schema.description.toLowerCase().includes(query)) return RANK_DESCRIPTION;
  const parameterText: string[] = [];
  collectParameterText(schema.parameters, parameterText);
  if (parameterText.some((text) => text.toLowerCase().includes(query))) {
    return RANK_PARAMETER;
  }
  return RANK_NONE;
}

/**
 * The tools a query selects, best match first and capped at `limit`.
 *
 * Ordering is total and deterministic: rank first, then name, so two tools that matched the same way
 * never trade places between calls. An empty query string matches nothing rather than everything —
 * "search for nothing" is a question with an empty answer, not a request for the whole catalog.
 */
export function matchDeferredTools(
  schemas: readonly IToolSchema[],
  query: string,
  limit: number,
): IToolSchema[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  return schemas
    .map((schema) => ({ schema, rank: rankMatch(schema, needle) }))
    .filter((entry) => entry.rank !== RANK_NONE)
    .sort((a, b) => a.rank - b.rank || (a.schema.name < b.schema.name ? -1 : 1))
    .slice(0, limit)
    .map((entry) => entry.schema);
}
