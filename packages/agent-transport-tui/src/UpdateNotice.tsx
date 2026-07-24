import { Box, Text } from 'ink';
import React from 'react';

import { PALETTE } from './tui-palette.js';

interface IProps {
  message: string;
}

export default function UpdateNotice({ message }: IProps): React.ReactElement {
  return (
    <Box paddingX={1} marginBottom={1}>
      <Text color={PALETTE.text.warning}>{message}</Text>
    </Box>
  );
}
