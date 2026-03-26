/**
 * Generic list picker with arrow-key navigation.
 * Renders items via a user-supplied renderItem function.
 */

import React, { useState, useRef } from 'react';
import { Box, useInput } from 'ink';

export interface IListPickerProps<T> {
  /** Items to display in the list */
  items: T[];
  /** Render function for each item — receives the item and whether it is currently selected */
  renderItem: (item: T, isSelected: boolean) => React.ReactElement;
  /** Called when the user presses Enter on the highlighted item */
  onSelect: (item: T) => void;
  /** Called when the user presses Escape */
  onCancel: () => void;
}

export default function ListPicker<T>({
  items,
  renderItem,
  onSelect,
  onCancel,
}: IListPickerProps<T>): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedRef = useRef(0);
  const resolvedRef = useRef(false);

  useInput((_input, key) => {
    if (resolvedRef.current) return;
    if (key.escape) {
      resolvedRef.current = true;
      onCancel();
      return;
    }
    if (items.length === 0) return;
    if (key.upArrow) {
      const next = selectedRef.current > 0 ? selectedRef.current - 1 : selectedRef.current;
      selectedRef.current = next;
      setSelectedIndex(next);
    } else if (key.downArrow) {
      const next =
        selectedRef.current < items.length - 1 ? selectedRef.current + 1 : selectedRef.current;
      selectedRef.current = next;
      setSelectedIndex(next);
    } else if (key.return) {
      const item = items[selectedRef.current];
      if (item !== undefined) {
        resolvedRef.current = true;
        onSelect(item);
      }
    }
  });

  if (items.length === 0) {
    return <Box />;
  }

  return (
    <Box flexDirection="column">
      {items.map((item, index) => (
        <Box key={index}>{renderItem(item, index === selectedIndex)}</Box>
      ))}
    </Box>
  );
}
