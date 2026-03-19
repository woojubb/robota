import React from 'react';
import { Box, Text } from 'ink';
import type { TPermissionMode } from '@robota-sdk/agent-core';

interface IProps {
  permissionMode: TPermissionMode;
  sessionId: string;
  messageCount: number;
  isThinking: boolean;
}

export default function StatusBar({
  permissionMode,
  sessionId: _sessionId,
  messageCount,
  isThinking,
}: IProps): React.ReactElement {
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
      </Text>
      <Text>
        {isThinking && <Text color="yellow">Thinking... </Text>}
        <Text dimColor>msgs: {messageCount}</Text>
      </Text>
    </Box>
  );
}
