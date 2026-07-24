import { Box, Text } from 'ink';
import React from 'react';

import { PALETTE } from './tui-palette.js';

interface IProps {
  percentage: number;
}

const COMPACT_SUGGESTION_THRESHOLD = 70;
const CRITICAL_THRESHOLD = 90;

export function ContextWarningBanner({ percentage }: IProps): React.ReactElement | null {
  if (percentage >= CRITICAL_THRESHOLD) {
    return (
      <Box borderStyle="single" borderColor={PALETTE.border.error} paddingX={1}>
        <Text color={PALETTE.text.error} bold>
          ⚠ Context at {Math.round(percentage)}% — window nearly full. Run /compact to summarize the
          conversation.
        </Text>
      </Box>
    );
  }

  if (percentage >= COMPACT_SUGGESTION_THRESHOLD) {
    return (
      <Box paddingX={1}>
        <Text color={PALETTE.text.warning}>
          Context at {Math.round(percentage)}% — consider running /compact to free up space.
        </Text>
      </Box>
    );
  }

  return null;
}
