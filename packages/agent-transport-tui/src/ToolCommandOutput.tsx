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

  // A successful command that produced no output used to render nothing, so the
  // user could not tell "ran, no output" from "not shown". Show a minimal
  // confirmation instead (SCREEN-005).
  if (
    summary.statusLabel === 'ok' &&
    summary.previewLines.length === 0 &&
    !summary.transcriptHint
  ) {
    const ok = STATUS_GLYPH.success;
    return (
      <Box marginLeft={4}>
        <Text color={ok.color} dimColor>
          {ok.symbol} ok
        </Text>
      </Box>
    );
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
