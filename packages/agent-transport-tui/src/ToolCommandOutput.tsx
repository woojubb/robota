import { Box, Text } from 'ink';
import React from 'react';

import { formatCommandOutputSummary } from './command-output-summary.js';
import { STATUS_GLYPH } from './status-glyph.js';

import type { ICommandOutputInput } from './command-output-summary.js';

interface IProps {
  tool: ICommandOutputInput;
}

export default function ToolCommandOutput({ tool }: IProps): React.ReactElement | null {
  const summary = formatCommandOutputSummary(tool);
  if (!summary) return null;

  // A successful command with no output renders nothing here: the parent
  // (MessageList ToolSummaryEntry) already shows a "✓ tool(args)" summary line for
  // every tool, so a second "✓ ok" line was a duplicate success marker (SCREEN-007).
  if (
    summary.statusLabel === 'ok' &&
    summary.previewLines.length === 0 &&
    !summary.transcriptHint
  ) {
    return null;
  }
  const color = summary.status === 'error' ? STATUS_GLYPH.error.color : 'white';

  return (
    <Box flexDirection="column" marginLeft={4}>
      {summary.statusLabel !== 'ok' && (
        <Text color={color} dimColor>
          {summary.statusLabel}
        </Text>
      )}
      {summary.previewLines.map((line, index) => (
        <Text key={`${line}-${index}`} color={color} dimColor>
          {line}
        </Text>
      ))}
      {summary.transcriptHint && <Text dimColor>{summary.transcriptHint}</Text>}
    </Box>
  );
}
