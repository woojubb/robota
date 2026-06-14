import { Box, Text, useInput } from 'ink';
import React from 'react';

import type { ITuiConfirmInteraction } from '../command-interaction.js';

interface IProps {
  commandName: string;
  interaction: ITuiConfirmInteraction;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function CommandConfirm({
  commandName,
  interaction,
  onConfirm,
  onCancel,
}: IProps): React.ReactElement {
  useInput((input, key) => {
    if (key.return || input === 'y' || input === 'Y') {
      onConfirm();
    } else if (key.escape || input === 'n' || input === 'N') {
      onCancel();
    }
  });

  return (
    <Box paddingX={1}>
      <Text bold color="yellow">
        /{commandName}:{' '}
      </Text>
      <Text>{interaction.message} </Text>
      <Text dimColor>[y/n]</Text>
    </Box>
  );
}
