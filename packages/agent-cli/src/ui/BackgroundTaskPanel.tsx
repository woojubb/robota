import React from 'react';
import { Box, Text } from 'ink';
import type { IBackgroundTaskViewModel } from './tui-state-manager.js';

interface IProps {
  tasks: IBackgroundTaskViewModel[];
}

function getStatusColor(status: IBackgroundTaskViewModel['status']): string {
  if (status === 'completed') return 'green';
  if (status === 'failed') return 'red';
  if (status === 'cancelled') return 'yellow';
  return 'cyan';
}

function getTaskPreview(task: IBackgroundTaskViewModel): string {
  return task.errorPreview ?? task.resultPreview ?? task.currentAction ?? task.preview;
}

export default function BackgroundTaskPanel({ tasks }: IProps): React.ReactElement | null {
  if (tasks.length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="cyan" bold>
        Background
      </Text>
      {tasks.map((task) => (
        <Text key={task.id}>
          {'- '}
          <Text color={getStatusColor(task.status)}>{task.status}</Text>
          {task.unread ? <Text color="yellow"> !</Text> : null}
          {` ${task.kind}:${task.label} ${task.id}`}
          {getTaskPreview(task) ? <Text dimColor>{` - ${getTaskPreview(task)}`}</Text> : null}
        </Text>
      ))}
    </Box>
  );
}
