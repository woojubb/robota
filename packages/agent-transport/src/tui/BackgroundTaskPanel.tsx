import { Box, Text } from 'ink';
import React from 'react';

import { formatBackgroundTaskRow } from './background-task-row-format.js';

import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-framework';

interface IProps {
  entries: IExecutionWorkspaceEntry[];
}

export default function BackgroundTaskPanel({ entries }: IProps): React.ReactElement | null {
  if (entries.length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="cyan" bold>
        Background work
      </Text>
      {entries.map((entry, index) => {
        const row = formatBackgroundTaskRow(entry, { isLast: index === entries.length - 1 });
        return (
          <Text key={entry.id}>
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
