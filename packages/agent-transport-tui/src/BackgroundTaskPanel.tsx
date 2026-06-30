import { Box, Text } from 'ink';
import React from 'react';

import { formatBackgroundTaskRow } from './background-task-row-format.js';

import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-transport';

interface IProps {
  entries: IExecutionWorkspaceEntry[];
}

export default function BackgroundTaskPanel({ entries }: IProps): React.ReactElement | null {
  if (entries.length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* SCREEN-013: advertise the drill-in. The Ctrl+B switcher (select ↑↓ · Enter to open) is the
          only way into a background task, but it was previously undiscoverable from the main UI. */}
      <Box>
        <Text color="cyan" bold>
          Background work
        </Text>
        <Text dimColor>{'  ·  Ctrl+B to view'}</Text>
      </Box>
      {entries.map((entry, index) => {
        const row = formatBackgroundTaskRow(entry, { isLast: index === entries.length - 1 });
        return (
          // SCREEN-011: keep each row to a single line so the connector + status glyph always sit at
          // the line start. Without this the long preview wraps onto an unconnected second line and
          // the tree glyphs lose meaning. Full text stays in `accessibleText` and the detail pane.
          <Text key={entry.id} wrap="truncate-end">
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
