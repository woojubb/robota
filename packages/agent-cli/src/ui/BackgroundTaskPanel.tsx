import React from 'react';
import { Box, Text } from 'ink';
import type { IBackgroundTaskViewModel } from './tui-state-manager.js';

interface IProps {
  tasks: IBackgroundTaskViewModel[];
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

function getStatusColor(status: IBackgroundTaskViewModel['status']): string {
  if (status === 'completed') return 'green';
  if (status === 'failed') return 'red';
  if (status === 'cancelled') return 'yellow';
  return 'cyan';
}

function getStatusMarker(status: IBackgroundTaskViewModel['status']): string {
  if (status === 'queued' || status === 'running') return '□';
  return '■';
}

function getTaskPreview(task: IBackgroundTaskViewModel): string {
  return task.errorPreview ?? task.resultPreview ?? task.currentAction ?? task.preview;
}

function formatAge(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return undefined;
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / MS_PER_SECOND));
  if (seconds < SECONDS_PER_MINUTE) return `${seconds}s`;
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m`;
  return `${Math.floor(minutes / MINUTES_PER_HOUR)}h`;
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
          <Text color={getStatusColor(task.status)}>{getStatusMarker(task.status)}</Text>
          {task.unread ? <Text color="yellow"> !</Text> : null}
          {` ${task.kind}:${task.label} ${task.id}`}
          {task.status === 'running' && formatAge(task.lastActivityAt) ? (
            <Text dimColor>{` idle ${formatAge(task.lastActivityAt)}`}</Text>
          ) : null}
          {task.timeoutReason ? <Text dimColor>{` (${task.timeoutReason})`}</Text> : null}
          {getTaskPreview(task) ? <Text dimColor>{` - ${getTaskPreview(task)}`}</Text> : null}
        </Text>
      ))}
    </Box>
  );
}
