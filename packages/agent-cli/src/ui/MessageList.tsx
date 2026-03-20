import React from 'react';
import { Box, Text } from 'ink';
import type { IChatMessage } from './types.js';
import { renderMarkdown } from './render-markdown.js';

interface IProps {
  messages: IChatMessage[];
}

function RoleLabel({ role }: { role: IChatMessage['role'] }): React.ReactElement {
  switch (role) {
    case 'user':
      return (
        <Text color="green" bold>
          You:{' '}
        </Text>
      );
    case 'assistant':
      return (
        <Text color="cyan" bold>
          Robota:{' '}
        </Text>
      );
    case 'system':
      return (
        <Text color="yellow" bold>
          System:{' '}
        </Text>
      );
    case 'tool':
      return (
        <Text color="magenta" bold>
          Tool:{' '}
        </Text>
      );
  }
}

function MessageItem({ message }: { message: IChatMessage }): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <RoleLabel role={message.role} />
        {message.toolName && (
          <Text color="magenta" dimColor>
            [{message.toolName}]{' '}
          </Text>
        )}
      </Box>
      <Text> </Text>
      <Box marginLeft={2}>
        <Text wrap="wrap">
          {message.role === 'assistant' ? renderMarkdown(message.content) : message.content}
        </Text>
      </Box>
    </Box>
  );
}

export default function MessageList({ messages }: IProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {messages.map((msg) => (
        <MessageItem key={msg.id} message={msg} />
      ))}
    </Box>
  );
}
