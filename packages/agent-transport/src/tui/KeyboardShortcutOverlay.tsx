import { Box, Text, useInput } from 'ink';
import React from 'react';

const SHORTCUTS: Array<{ key: string; description: string }> = [
  { key: 'Enter', description: 'Submit message' },
  { key: 'ESC', description: 'Abort running task' },
  { key: 'Ctrl+C', description: 'Exit' },
  { key: '↑ / ↓', description: 'Navigate input history' },
  { key: 'Ctrl+B', description: 'Open background task switcher' },
  { key: '/compact', description: 'Summarize conversation to free context' },
  { key: '/help', description: 'List all slash commands' },
  { key: '?', description: 'Close this overlay' },
];

interface IProps {
  onClose: () => void;
}

export default function KeyboardShortcutOverlay({ onClose }: IProps): React.ReactElement {
  useInput((input, key) => {
    if (input === '?' || key.escape) {
      onClose();
    }
  });

  const keyWidth = Math.max(...SHORTCUTS.map((s) => s.key.length)) + 2;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} paddingY={0}>
      <Text color="cyan" bold>
        Keyboard Shortcuts
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {SHORTCUTS.map(({ key, description }) => (
          <Box key={key}>
            <Text color="yellow" bold>
              {key.padEnd(keyWidth)}
            </Text>
            <Text>{description}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press ? or ESC to close</Text>
      </Box>
    </Box>
  );
}
