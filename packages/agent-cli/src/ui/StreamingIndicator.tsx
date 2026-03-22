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
  /** 'success' | 'error' | 'denied' — set after tool completes */
  result?: 'success' | 'error' | 'denied';
}

function getToolStyle(t: IToolExecutionState): {
  color: string;
  icon: string;
  strikethrough: boolean;
} {
  if (t.isRunning) return { color: 'yellow', icon: '⟳', strikethrough: false };
  if (t.result === 'error') return { color: 'red', icon: '✗', strikethrough: true };
  if (t.result === 'denied') return { color: 'yellowBright', icon: '⊘', strikethrough: true };
  return { color: 'green', icon: '✓', strikethrough: false };
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
          <Text color="white" bold>
            Tools:
          </Text>
          <Text> </Text>
          {activeTools.map((t, i) => {
            const { color, icon, strikethrough } = getToolStyle(t);
            return (
              <Text key={`${t.toolName}-${i}`} color={color} strikethrough={strikethrough}>
                {'  '}
                {icon} {t.toolName}({t.firstArg})
              </Text>
            );
          })}
        </Box>
      )}
      {hasText && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="cyan" bold>
            Robota:
          </Text>
          <Text> </Text>
          <Box marginLeft={2}>
            <Text wrap="wrap">{renderMarkdown(text)}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
