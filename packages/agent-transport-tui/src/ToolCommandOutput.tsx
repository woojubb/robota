import React from 'react';
import { Box, Text } from 'ink';
import type { ICommandOutputInput } from './command-output-summary.js';
import { formatCommandOutputSummary } from './command-output-summary.js';

interface IProps {
  tool: ICommandOutputInput;
}

export default function ToolCommandOutput({ tool }: IProps): React.ReactElement | null {
  const summary = formatCommandOutputSummary(tool);
  if (!summary) return null;
  if (
    summary.statusLabel === 'ok' &&
    summary.previewLines.length === 0 &&
    !summary.transcriptHint
  ) {
    return null;
  }
  const color = summary.status === 'error' ? 'red' : 'white';

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
