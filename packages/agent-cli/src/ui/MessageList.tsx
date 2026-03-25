import React from 'react';
import { Box, Text } from 'ink';
import type { TUniversalMessage } from '@robota-sdk/agent-core';
import { isToolMessage, isAssistantMessage } from '@robota-sdk/agent-core';
import { renderMarkdown } from './render-markdown.js';
import type { IToolCallSummary } from '../utils/tool-call-extractor.js';
import DiffBlock from './DiffBlock.js';

interface IProps {
  messages: TUniversalMessage[];
}

function RoleLabel({ role }: { role: TUniversalMessage['role'] }): React.ReactElement {
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
        <Text color="white" bold>
          Tool:{' '}
        </Text>
      );
  }
}

function ToolMessage({ message }: { message: TUniversalMessage }): React.ReactElement {
  if (!isToolMessage(message)) {
    return <></>;
  }
  const toolName = message.name;
  const content = message.content;

  // Try to parse structured tool summaries (with diff info)
  let summaries: IToolCallSummary[] | null = null;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0].line === 'string') {
      summaries = parsed as IToolCallSummary[];
    }
  } catch {
    // Not JSON — fall back to plain text lines
  }

  if (summaries) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color="white" bold>
            Tool:{' '}
          </Text>
          {toolName && (
            <Text color="white" dimColor>
              [{toolName}]
            </Text>
          )}
        </Box>
        <Text> </Text>
        {summaries.map((s, i) => (
          <Box key={i} flexDirection="column">
            <Text color="green">
              {'  '}
              {'✓'} {s.line}
            </Text>
            {s.diffLines && s.diffLines.length > 0 && (
              <DiffBlock file={s.diffFile} lines={s.diffLines} />
            )}
          </Box>
        ))}
      </Box>
    );
  }

  // Fallback: plain text lines
  const lines = content.split('\n').filter((l) => l.trim());
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="white" bold>
          Tool:{' '}
        </Text>
        {toolName && (
          <Text color="white" dimColor>
            [{toolName}]
          </Text>
        )}
      </Box>
      <Text> </Text>
      {lines.map((line, i) => (
        <Text key={i} color="green">
          {'  '}
          {'✓'} {line}
        </Text>
      ))}
    </Box>
  );
}

const MessageItem = React.memo(function MessageItem({
  message,
}: {
  message: TUniversalMessage;
}): React.ReactElement {
  if (isToolMessage(message)) {
    return <ToolMessage message={message} />;
  }

  const content = message.content ?? '';
  const isInterrupted = message.state === 'interrupted';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <RoleLabel role={message.role} />
      </Box>
      <Text> </Text>
      <Box marginLeft={2}>
        <Text wrap="wrap">
          {isAssistantMessage(message)
            ? renderMarkdown(content + (isInterrupted ? '\n\n_(interrupted)_' : ''))
            : content}
        </Text>
      </Box>
    </Box>
  );
});

export default function MessageList({ messages }: IProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {messages.map((msg) => (
        <MessageItem key={msg.id} message={msg} />
      ))}
    </Box>
  );
}
