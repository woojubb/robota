/**
 * Reusable confirmation prompt with arrow-key selection.
 * Used by model change, permission prompts, and other yes/no confirmations.
 */

import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

interface IProps {
  /** Message to display above the options */
  message: string;
  /** Options to select from (default: ['Yes', 'No']) */
  options?: string[];
  /** Callback with the selected index */
  onSelect: (index: number) => void;
}

export default function ConfirmPrompt({
  message,
  options = ['Yes', 'No'],
  onSelect,
}: IProps): React.ReactElement {
  const [selected, setSelected] = useState(0);
  const resolvedRef = useRef(false);

  const doSelect = useCallback(
    (index: number) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      onSelect(index);
    },
    [onSelect],
  );

  useInput((input, key) => {
    if (resolvedRef.current) return;
    if (key.leftArrow || key.upArrow) {
      setSelected((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (key.rightArrow || key.downArrow) {
      setSelected((prev) => (prev < options.length - 1 ? prev + 1 : prev));
    } else if (key.return) {
      doSelect(selected);
    } else if (input === 'y' && options.length === 2) {
      doSelect(0);
    } else if (input === 'n' && options.length === 2) {
      doSelect(1);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">{message}</Text>
      <Box marginTop={1}>
        {options.map((opt, i) => (
          <Box key={opt} marginRight={2}>
            <Text color={i === selected ? 'cyan' : undefined} bold={i === selected}>
              {i === selected ? '> ' : '  '}
              {opt}
            </Text>
          </Box>
        ))}
      </Box>
      <Text dimColor> arrow keys to select, Enter to confirm</Text>
    </Box>
  );
}
