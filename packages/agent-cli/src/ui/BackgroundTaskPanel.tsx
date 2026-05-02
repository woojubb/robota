import React from 'react';
import { Box, Text } from 'ink';
import type { IBackgroundTaskViewModel } from './tui-state-manager.js';
import { formatBackgroundTaskRow } from './background-task-row-format.js';

interface IProps {
  tasks: IBackgroundTaskViewModel[];
}

export default function BackgroundTaskPanel({ tasks }: IProps): React.ReactElement | null {
  if (tasks.length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="cyan" bold>
        Background work
      </Text>
      {tasks.map((task, index) => {
        const row = formatBackgroundTaskRow(task, { isLast: index === tasks.length - 1 });
        return (
          <Text key={task.id}>
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
