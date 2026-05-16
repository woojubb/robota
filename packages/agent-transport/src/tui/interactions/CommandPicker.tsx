import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { ITuiPickerInteraction, ITuiPickerItem } from '../command-interaction.js';

interface IProps {
  commandName: string;
  interaction: ITuiPickerInteraction;
  onSelect: (item: ITuiPickerItem) => void;
  onCancel: () => void;
}

const MAX_VISIBLE = 8;
const OUTER_CHROME = 4;
const MIN_ROW_WIDTH = 40;

function useRowWidth(): number {
  const { stdout } = useStdout();
  return Math.max(MIN_ROW_WIDTH, (stdout.columns ?? 80) - OUTER_CHROME);
}

export default function CommandPicker({
  commandName,
  interaction,
  onSelect,
  onCancel,
}: IProps): React.ReactElement {
  const items = interaction.getItems();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const rowWidth = useRowWidth();

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => (i > 0 ? i - 1 : items.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => (i < items.length - 1 ? i + 1 : 0));
    } else if (key.return) {
      const item = items[selectedIndex];
      if (item) onSelect(item);
    } else if (key.escape || input === 'q') {
      onCancel();
    }
  });

  const scrollOffset = (() => {
    if (items.length <= MAX_VISIBLE) return 0;
    if (selectedIndex < MAX_VISIBLE) return 0;
    return Math.min(selectedIndex - MAX_VISIBLE + 1, items.length - MAX_VISIBLE);
  })();
  const visibleItems = items.slice(scrollOffset, scrollOffset + MAX_VISIBLE);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        /{commandName}
      </Text>
      {visibleItems.map((item, i) => {
        const isSelected = scrollOffset + i === selectedIndex;
        const indicator = isSelected ? '▸ ' : '  ';
        return (
          <Box key={item.value} width={rowWidth}>
            <Text
              color={isSelected ? 'cyan' : undefined}
              dimColor={!isSelected}
              wrap="truncate-end"
            >
              {indicator}
              {item.label}
              {item.description != null ? `  ${item.description}` : ''}
            </Text>
          </Box>
        );
      })}
      <Text dimColor>↑↓ navigate · Enter select · Esc cancel</Text>
    </Box>
  );
}
