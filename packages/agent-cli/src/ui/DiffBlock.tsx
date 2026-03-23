/**
 * DiffBlock — renders a compact diff with file header, colored +/- lines.
 * Shared by StreamingIndicator (real-time) and MessageList (post-execution).
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { IDiffLine } from '../utils/edit-diff.js';

const MAX_DIFF_LINES = 10;
const TRUNCATED_SHOW = 8;

interface IProps {
  file?: string;
  lines: IDiffLine[];
}

export default function DiffBlock({ file, lines }: IProps): React.ReactElement {
  const truncated = lines.length > MAX_DIFF_LINES;
  const visible = truncated ? lines.slice(0, TRUNCATED_SHOW) : lines;
  const remaining = lines.length - TRUNCATED_SHOW;

  return (
    <Box flexDirection="column" marginLeft={4}>
      {file && (
        <Text color="white" dimColor>
          │ {file}
        </Text>
      )}
      {visible.map((line, i) => (
        <Text key={i} color={line.type === 'remove' ? 'red' : 'greenBright'}>
          │ {line.type === 'remove' ? '-' : '+'} {line.text}
        </Text>
      ))}
      {truncated && (
        <Text color="white" dimColor>
          │ ... and {remaining} more lines
        </Text>
      )}
    </Box>
  );
}
