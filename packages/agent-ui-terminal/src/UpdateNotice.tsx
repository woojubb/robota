import { Box } from 'ink';
import React from 'react';

import { Text } from './SafeText.js';
import { usePalette } from './theme/index.js';

interface IProps {
  message: string;
}

export default function UpdateNotice({ message }: IProps): React.ReactElement {
  const palette = usePalette();
  return (
    <Box paddingX={1} marginBottom={1}>
      <Text color={palette.text.warning}>{message}</Text>
    </Box>
  );
}
