import { Box } from 'ink';
import React from 'react';

import { formatBackgroundTaskRow } from './background-task-row-format.js';
import { useCountdownTick } from './hooks/useCountdownTick.js';
import { Text } from './SafeText.js';
import { useScreenReader } from './screen-reader-context.js';
import { statusGlyphColor } from './status-glyph.js';
import { usePalette } from './theme/index.js';

import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface/execution';

interface IProps {
  entries: IExecutionWorkspaceEntry[];
  /** Index of the keyboard-focused row, or null when the prompt input is focused. */
  focusedIndex?: number | null;
}

export default function BackgroundTaskPanel({
  entries,
  focusedIndex = null,
}: IProps): React.ReactElement | null {
  const palette = usePalette();
  const screenReader = useScreenReader();
  // Ticks once a second only while a schedule sleeps, never in screen-reader mode.
  const now = useCountdownTick(
    entries.some((entry) => entry.nextFireAt !== undefined),
    screenReader,
  );
  if (entries.length === 0) return null;

  // The hint is focus-aware — it tells you how to enter the list, then how to move/open.
  const hint =
    focusedIndex !== null ? '  ·  ↑↓ select · Enter open · Esc back' : '  ·  ↓ select · Ctrl+B all';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={palette.text.accent} bold>
          Background work
        </Text>
        <Text dimColor>{hint}</Text>
      </Box>
      {entries.map((entry, index) => {
        const row = formatBackgroundTaskRow(entry, {
          isLast: index === entries.length - 1,
          screenReader,
          now,
        });
        const isFocused = index === focusedIndex;
        return (
          // One truncated line so the connector + glyph lead the row.
          // The keyboard-focused row is inverse-highlighted.
          <Text key={entry.id} wrap="truncate-end" inverse={isFocused}>
            {`${row.connector} `}
            <Text
              color={statusGlyphColor(palette, row.statusKind)}
            >{`${row.marker} ${row.state}`}</Text>
            {` ${row.label}`}
            {row.segments.map((segment, segmentIndex) => (
              <Text key={`${segment}-${segmentIndex}`} dimColor>{` · ${segment}`}</Text>
            ))}
            {row.headline ? <Text dimColor>{` · ${row.headline}`}</Text> : null}
            {row.preview ? <Text dimColor>{` · ${row.preview}`}</Text> : null}
            {row.countdown ? (
              <Text color={statusGlyphColor(palette, row.statusKind)}>{` · ${row.countdown}`}</Text>
            ) : null}
          </Text>
        );
      })}
    </Box>
  );
}
