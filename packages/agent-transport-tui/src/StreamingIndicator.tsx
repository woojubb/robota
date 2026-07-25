/**
 * Streaming indicator — shows real-time tool execution and AI response text.
 * Displayed during session.run() execution.
 */

import { Box, Text } from 'ink';
import React from 'react';

import { humanizeToolName } from './humanize-tool-name.js';
import { renderMarkdown } from './render-markdown.js';
import { STATUS_GLYPH, toolStateStatusKind } from './status-glyph.js';
import ToolDiffBlock from './ToolDiffBlock.js';
import { PALETTE } from './tui-palette.js';

import type { IToolState } from '@robota-sdk/agent-interface-transport';

function getToolStyle(t: IToolState): {
  color: string;
  icon: string;
  strikethrough: boolean;
} {
  const kind = toolStateStatusKind(t);
  const { color, symbol } = STATUS_GLYPH[kind];
  return { color, icon: symbol, strikethrough: kind === 'error' || kind === 'denied' };
}

interface IProps {
  text: string;
  activeTools: IToolState[];
  isThinking?: boolean;
}

function renderThinkingFallback(isThinking: boolean): React.ReactElement {
  if (!isThinking) return <></>;
  return (
    <Box marginBottom={1}>
      <Text color={PALETTE.text.warning}>Thinking...</Text>
    </Box>
  );
}

function renderTools(activeTools: IToolState[]): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={PALETTE.text.emphasis} bold>
        Tools:
      </Text>
      <Text> </Text>
      {activeTools.map((t, i) => {
        const { color, icon, strikethrough } = getToolStyle(t);
        return (
          <Box key={`${t.toolName}-${i}`} flexDirection="column">
            <Text color={color} strikethrough={strikethrough}>
              {'  '}
              {icon} {humanizeToolName(t.toolName)}({t.firstArg})
            </Text>
            {t.diffLines && t.diffLines.length > 0 && (
              <ToolDiffBlock file={t.diffFile} lines={t.diffLines} />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export default function StreamingIndicator({
  text,
  activeTools,
  isThinking = false,
}: IProps): React.ReactElement {
  const hasTools = activeTools.length > 0;
  const hasText = text.length > 0;

  if (!hasTools && !hasText) {
    return renderThinkingFallback(isThinking);
  }

  return (
    <Box flexDirection="column">
      {hasTools && renderTools(activeTools)}
      {hasText && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={PALETTE.text.accent} bold>
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
