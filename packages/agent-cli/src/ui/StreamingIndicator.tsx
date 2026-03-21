/**
 * Streaming indicator — shows real-time tool execution and AI response text.
 * Displayed during session.run() execution.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { renderMarkdown } from './render-markdown.js';

export interface IToolExecutionState {
  toolName: string;
  firstArg: string;
  isRunning: boolean;
}

interface IProps {
  text: string;
  activeTools: IToolExecutionState[];
}

export default function StreamingIndicator({ text, activeTools }: IProps): React.ReactElement {
  const hasTools = activeTools.length > 0;
  const hasText = text.length > 0;

  if (!hasTools && !hasText) {
    return <Text color="yellow">Thinking...</Text>;
  }

  return (
    <Box flexDirection="column">
      {hasTools && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="gray" bold>Tools:</Text>
          <Text> </Text>
          {activeTools.map((t, i) => (
            <Text key={`${t.toolName}-${i}`} color={t.isRunning ? 'yellow' : 'green'}>
              {'  '}{t.isRunning ? '⟳' : '✓'} {t.toolName}({t.firstArg})
            </Text>
          ))}
        </Box>
      )}
      {hasText && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="cyan" bold>Robota:</Text>
          <Text> </Text>
          <Box marginLeft={2}>
            <Text wrap="wrap">{renderMarkdown(text)}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
