import { Box, Text } from 'ink';
import React from 'react';

import { formatBackgroundTaskRow } from './background-task-row-format.js';

import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-transport';

interface IProps {
  entries: IExecutionWorkspaceEntry[];
  /** Index of the keyboard-focused row (SCREEN-014), or null when the prompt input is focused. */
  focusedIndex?: number | null;
}

export default function BackgroundTaskPanel({
  entries,
  focusedIndex = null,
}: IProps): React.ReactElement | null {
  if (entries.length === 0) return null;

  // SCREEN-014: the hint is focus-aware — it tells you how to enter the list, then how to move/open.
  const hint =
    focusedIndex !== null ? '  ·  ↑↓ select · Enter open · Esc back' : '  ·  ↓ select · Ctrl+B all';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="cyan" bold>
          Background work
        </Text>
        <Text dimColor>{hint}</Text>
      </Box>
      {entries.map((entry, index) => {
        const row = formatBackgroundTaskRow(entry, { isLast: index === entries.length - 1 });
        const isFocused = index === focusedIndex;
        return (
          // SCREEN-011: one truncated line so the connector + glyph lead the row.
          // SCREEN-014: the keyboard-focused row is inverse-highlighted.
          <Text key={entry.id} wrap="truncate-end" inverse={isFocused}>
            {`${row.connector} `}
            <Text color={row.color}>{row.marker}</Text>
            {` ${row.label}`}
            {row.segments.map((segment, segmentIndex) => (
              <Text key={`${segment}-${segmentIndex}`} dimColor>{` · ${segment}`}</Text>
            ))}
            {row.preview ? <Text dimColor>{` · ${row.preview}`}</Text> : null}
          </Text>
        );
      })}
    </Box>
  );
}
