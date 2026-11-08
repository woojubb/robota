/**
 * SCREEN-1993 — the pure half of reverse prompt-history search: filtering with match ranges,
 * collapse-to-newest dedup, the scope cycle and the run split a match is rendered from.
 */
import type { IPromptHistoryEntry } from '@robota-sdk/agent-interface-session';

export type THistorySearchScope = 'all' | 'session' | 'project';

/** `all → session → project → all`: the widest first, narrowing on each press. */
const HISTORY_SEARCH_SCOPES: readonly THistorySearchScope[] = ['all', 'session', 'project'];

export function cycleScope(scope: THistorySearchScope): THistorySearchScope {
  const index = HISTORY_SEARCH_SCOPES.indexOf(scope);
  return HISTORY_SEARCH_SCOPES[(index + 1) % HISTORY_SEARCH_SCOPES.length] ?? 'all';
}

export interface IHistorySearchScopeContext {
  readonly sessionId: string;
  readonly project: string;
}

/** Whether an entry belongs to the scope for this session and project. */
export function inScope(
  entry: IPromptHistoryEntry,
  scope: THistorySearchScope,
  context: IHistorySearchScopeContext,
): boolean {
  switch (scope) {
    case 'all':
      return true;
    case 'session':
      return entry.sessionId === context.sessionId;
    case 'project':
      return entry.project === context.project;
  }
}

/** Search-time dedup: the first (newest) occurrence of a trimmed text wins; order is preserved. */
export function collapseToNewest(entries: readonly IPromptHistoryEntry[]): IPromptHistoryEntry[] {
  const seen = new Set<string>();
  const collapsed: IPromptHistoryEntry[] = [];
  for (const entry of entries) {
    const key = entry.text.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    collapsed.push(entry);
  }
  return collapsed;
}

export interface IHistorySearchMatch {
  readonly entry: IPromptHistoryEntry;
  /** `[start, end)` of the query inside `entry.text`; empty when the query is empty. */
  readonly ranges: readonly (readonly [number, number])[];
}

/** Case-insensitive substring filter; an empty query matches everything with no ranges. */
export function filterPrompts(
  entries: readonly IPromptHistoryEntry[],
  query: string,
): IHistorySearchMatch[] {
  const needle = query.toLowerCase();
  if (needle.length === 0) return entries.map((entry) => ({ entry, ranges: [] }));
  const matches: IHistorySearchMatch[] = [];
  for (const entry of entries) {
    const haystack = entry.text.toLowerCase();
    const ranges: (readonly [number, number])[] = [];
    let from = 0;
    for (;;) {
      const index = haystack.indexOf(needle, from);
      if (index === -1) break;
      ranges.push([index, index + needle.length]);
      from = index + needle.length;
    }
    if (ranges.length > 0) matches.push({ entry, ranges });
  }
  return matches;
}

/** Text split into plain and highlighted runs, for rendering a match without colour dependence. */
export function splitByRanges(
  text: string,
  ranges: readonly (readonly [number, number])[],
): { readonly text: string; readonly matched: boolean }[] {
  const runs: { text: string; matched: boolean }[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) runs.push({ text: text.slice(cursor, start), matched: false });
    runs.push({ text: text.slice(start, end), matched: true });
    cursor = end;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), matched: false });
  return runs;
}
