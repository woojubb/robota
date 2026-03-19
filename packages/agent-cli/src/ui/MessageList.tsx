import React from 'react';
import { Box, Text } from 'ink';
import type { IChatMessage } from './types.js';

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

/** Render content with tool indicators highlighted */
function HighlightedContent({ content }: { content: string }): React.ReactElement {
  const lines = content.split('\n');
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        if (line.includes('🔍 Searching:') || line.includes('🔍 [')) {
          return (
            <Text key={i} backgroundColor="blue" color="white" bold>
              {' '}
              {line.trim()}{' '}
            </Text>
          );
        }
        if (line.startsWith('[Web Search Results]')) {
          return (
            <Text key={i} color="yellow" bold>
              {line}
            </Text>
          );
        }
        return (
          <Text key={i} wrap="wrap">
            {line}
          </Text>
        );
      })}
    </Box>
  );
}

function MessageItem({ message }: { message: IChatMessage }): React.ReactElement {
  const hasToolIndicators =
    message.content.includes('🔍') || message.content.includes('[Web Search Results]');

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
        {hasToolIndicators ? (
          <HighlightedContent content={message.content} />
        ) : (
          <Text wrap="wrap">{message.content}</Text>
        )}
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
