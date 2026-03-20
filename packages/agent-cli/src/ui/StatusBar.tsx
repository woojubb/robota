import React from 'react';
import { Box, Text } from 'ink';
import type { TPermissionMode } from '@robota-sdk/agent-core';

/** Threshold boundaries for context percentage color coding */
const CONTEXT_YELLOW_THRESHOLD = 70;
const CONTEXT_RED_THRESHOLD = 90;

interface IProps {
  permissionMode: TPermissionMode;
  modelName: string;
  sessionId: string;
  messageCount: number;
  isThinking: boolean;
  contextPercentage: number;
  contextUsedTokens: number;
  contextMaxTokens: number;
}

/** Return the color for the context percentage indicator */
function getContextColor(percentage: number): string {
  if (percentage >= CONTEXT_RED_THRESHOLD) return 'red';
  if (percentage >= CONTEXT_YELLOW_THRESHOLD) return 'yellow';
  return 'green';
}

export default function StatusBar({
  permissionMode,
  modelName,
  sessionId: _sessionId,
  messageCount,
  isThinking,
  contextPercentage,
  contextUsedTokens,
  contextMaxTokens,
}: IProps): React.ReactElement {
  const contextColor = getContextColor(contextPercentage);

  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingLeft={1}
      paddingRight={1}
      justifyContent="space-between"
    >
      <Text>
        <Text color="cyan" bold>
          Mode:
        </Text>{' '}
        <Text>{permissionMode}</Text>
        {'  |  '}
        <Text dimColor>{modelName}</Text>
        {'  |  '}
        <Text color={contextColor}>
          Context: {Math.round(contextPercentage)}% ({(contextUsedTokens / 1000).toFixed(1)}k/
          {(contextMaxTokens / 1000).toFixed(0)}k)
        </Text>
      </Text>
      <Text>
        {isThinking && <Text color="yellow">Thinking... </Text>}
        <Text dimColor>msgs: {messageCount}</Text>
      </Text>
    </Box>
  );
}
