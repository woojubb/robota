/**
 * DiffBlock — renders a compact diff with file header, line numbers, colored +/- lines.
 * Shared by StreamingIndicator (real-time) and MessageList (post-execution).
 *
 * Remove lines: red background + white text
 * Add lines: green background + white text
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

  // Calculate max line number width for alignment
  const maxLineNum = Math.max(...visible.map((l) => l.lineNumber), 0);
  const numWidth = String(maxLineNum).length;

  return (
    <Box flexDirection="column" marginLeft={4}>
      {file && (
        <Text color="white" dimColor>
          │ {file}
        </Text>
      )}
      {visible.map((line, i) => {
        const lineNum = String(line.lineNumber).padStart(numWidth, ' ');
        const prefix = line.type === 'remove' ? '-' : '+';
        const bgColor = line.type === 'remove' ? 'red' : 'green';

        return (
          <Text key={i}>
            <Text color="white" dimColor>
              │{' '}
            </Text>
            <Text color="white" dimColor>
              {lineNum}{' '}
            </Text>
            <Text color="white" backgroundColor={bgColor}>
              {' '}
              {prefix} {line.text}{' '}
            </Text>
          </Text>
        );
      })}
      {truncated && (
        <Text color="white" dimColor>
          │ ... and {remaining} more lines
        </Text>
      )}
    </Box>
  );
}
