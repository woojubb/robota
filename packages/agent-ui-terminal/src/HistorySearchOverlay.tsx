/**
 * SCREEN-1993 — the reverse prompt-history search overlay (Ctrl+R), rendered inside the input area
 * on the `SlashAutocomplete` pattern. The query line, the scope label, the matches newest-first with
 * the query highlighted, the load state and the footer of live keys.
 *
 * The highlight survives `NO_COLOR`: when the process emits no colour, a matched run is wrapped in
 * visible brackets instead of relying on an SGR attribute nothing would render.
 */
import { Box } from 'ink';
import React from 'react';

import { splitByRanges, type IHistorySearchMatch } from './history-search/history-search-flow.js';
import {
  KeyHintFooter,
  SELECTION_INDICATOR,
  SELECTION_INDICATOR_NONE,
  type IKeyHint,
} from './key-hint-footer.js';
import { useKeybindingHints } from './keybindings/keybindings-context.js';
import { numberedRowPrefix } from './numbered-list.js';
import { Text } from './SafeText.js';
import { useScreenReader } from './screen-reader-context.js';
import { isInteractiveColorTerminal } from './terminal-capabilities.js';
import { PALETTE } from './tui-palette.js';

import type { IHistorySearchView } from './history-search/useHistorySearch.js';

/** Footer for the overlay, in the default bindings. */
export const HISTORY_SEARCH_FOOTER_HINTS: readonly IKeyHint[] = [
  { keys: '↑↓', label: 'Navigate' },
  { keys: 'Ctrl+S', label: 'Scope' },
  { keys: 'Enter/Tab', label: 'Insert' },
  { keys: 'Ctrl+E', label: 'Run' },
  { keys: 'Esc', label: 'Close' },
];

const MAX_VISIBLE = 8;

function scrollOffset(selectedIndex: number, total: number): number {
  if (total <= MAX_VISIBLE || selectedIndex < MAX_VISIBLE) return 0;
  return Math.min(selectedIndex - MAX_VISIBLE + 1, total - MAX_VISIBLE);
}

/** `1 unreadable line skipped` / `3 unreadable lines skipped`. */
function formatSkippedLines(count: number): string {
  return `${count} unreadable ${count === 1 ? 'line' : 'lines'} skipped`;
}

function MatchRow(props: {
  readonly match: IHistorySearchMatch;
  readonly selected: boolean;
  readonly rowNumber: number | undefined;
  readonly color: boolean;
}): React.ReactElement {
  const { match, selected, rowNumber, color } = props;
  const indicator =
    rowNumber !== undefined
      ? numberedRowPrefix(rowNumber)
      : selected
        ? SELECTION_INDICATOR
        : SELECTION_INDICATOR_NONE;
  // A stored prompt may span lines; one visible glyph per newline keeps the row a row and the
  // match ranges aligned (same length).
  const runs = splitByRanges(match.entry.text.replace(/\n/gu, '↵'), match.ranges);
  return (
    <Text
      color={selected ? PALETTE.text.accent : undefined}
      dimColor={!selected}
      wrap="truncate-end"
    >
      {indicator}
      {runs.map((run, index) =>
        run.matched ? (
          <Text key={index} bold inverse={color}>
            {color ? run.text : `[${run.text}]`}
          </Text>
        ) : (
          <Text key={index}>{run.text}</Text>
        ),
      )}
    </Text>
  );
}

function StateLine({ view }: { readonly view: IHistorySearchView }): React.ReactElement {
  if (view.error !== undefined) {
    return <Text color={PALETTE.text.error}>History could not be read: {view.error}</Text>;
  }
  const parts: string[] = [];
  if (view.matches.length === 0) {
    parts.push(
      view.loading ? 'loading…' : view.query.length === 0 ? 'no stored prompts yet' : 'no match',
    );
  } else {
    parts.push(`${view.matches.length} match${view.matches.length === 1 ? '' : 'es'}`);
    if (view.loading) parts.push('loading…');
  }
  if (view.skippedLines > 0) parts.push(formatSkippedLines(view.skippedLines));
  return <Text dimColor>{parts.join(' · ')}</Text>;
}

export default function HistorySearchOverlay({
  view,
}: {
  readonly view: IHistorySearchView;
}): React.ReactElement | null {
  const screenReader = useScreenReader();
  const color = isInteractiveColorTerminal();
  const footerHints = useKeybindingHints('history-search', [
    [['previous', 'next'], 'Navigate'],
    ['cycle-scope', 'Scope'],
    ['insert', 'Insert'],
    ['execute', 'Run'],
    ['cancel', 'Close'],
  ]);
  if (!view.open) return null;
  const offset = scrollOffset(view.selectedIndex, view.matches.length);
  const visible = view.matches.slice(offset, offset + MAX_VISIBLE);
  return (
    <Box
      flexDirection="column"
      {...(screenReader
        ? {}
        : { borderStyle: 'round' as const, borderColor: PALETTE.border.muted })}
      paddingX={1}
    >
      <Text>
        <Text color={PALETTE.text.accent}>(reverse-i-search)</Text> scope: {view.scope} · query:{' '}
        {view.query}
      </Text>
      {visible.map((match, index) => (
        <MatchRow
          key={`${match.entry.at}:${offset + index}`}
          match={match}
          selected={offset + index === view.selectedIndex}
          rowNumber={screenReader ? offset + index : undefined}
          color={color}
        />
      ))}
      <StateLine view={view} />
      <KeyHintFooter hints={footerHints} />
    </Box>
  );
}
