import { Box } from 'ink';
import React from 'react';

import { Text } from './SafeText.js';
import { useScreenReader } from './screen-reader-context.js';
import { usePalette } from './theme/index.js';

interface IProps {
  percentage: number;
}

const COMPACT_SUGGESTION_THRESHOLD = 70;
const CRITICAL_THRESHOLD = 90;

export function ContextWarningBanner({ percentage }: IProps): React.ReactElement | null {
  const palette = usePalette();
  const screenReader = useScreenReader();
  if (percentage >= CRITICAL_THRESHOLD) {
    return (
      <Box
        {...(screenReader
          ? {}
          : { borderStyle: 'single' as const, borderColor: palette.border.error })}
        paddingX={1}
      >
        <Text color={palette.text.error} bold>
          ⚠ Context at {Math.round(percentage)}% — window nearly full. Run /compact to summarize the
          conversation.
        </Text>
      </Box>
    );
  }

  if (percentage >= COMPACT_SUGGESTION_THRESHOLD) {
    return (
      <Box paddingX={1}>
        <Text color={palette.text.warning}>
          Context at {Math.round(percentage)}% — consider running /compact to free up space.
        </Text>
      </Box>
    );
  }

  return null;
}
