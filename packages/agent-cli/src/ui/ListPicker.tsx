/**
 * Generic list picker with arrow-key navigation and viewport scrolling.
 * Renders items via a user-supplied renderItem function.
 * Shows a limited number of items at a time; scrolls as the cursor moves.
 */

import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

/** Default number of visible items */
const DEFAULT_MAX_VISIBLE = 10;

export interface IListPickerProps<T> {
  /** Items to display in the list */
  items: T[];
  /** Render function for each item — receives the item and whether it is currently selected */
  renderItem: (item: T, isSelected: boolean) => React.ReactElement;
  /** Called when the user presses Enter on the highlighted item */
  onSelect: (item: T) => void;
  /** Called when the user presses Escape */
  onCancel: () => void;
  /** Maximum number of items visible at once (default: 10) */
  maxVisible?: number;
}

export default function ListPicker<T>({
  items,
  renderItem,
  onSelect,
  onCancel,
  maxVisible = DEFAULT_MAX_VISIBLE,
}: IListPickerProps<T>): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
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
      // Scroll up if cursor goes above viewport
      if (next < scrollOffset) {
        setScrollOffset(next);
      }
    } else if (key.downArrow) {
      const next =
        selectedRef.current < items.length - 1 ? selectedRef.current + 1 : selectedRef.current;
      selectedRef.current = next;
      setSelectedIndex(next);
      // Scroll down if cursor goes below viewport
      if (next >= scrollOffset + maxVisible) {
        setScrollOffset(next - maxVisible + 1);
      }
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

  const visibleItems = items.slice(scrollOffset, scrollOffset + maxVisible);
  const hasMore = scrollOffset + maxVisible < items.length;
  const hasLess = scrollOffset > 0;

  return (
    <Box flexDirection="column">
      {hasLess && <Text dimColor> ↑ {scrollOffset} more above</Text>}
      {visibleItems.map((item, index) => (
        <Box key={scrollOffset + index} marginBottom={1}>
          {renderItem(item, scrollOffset + index === selectedIndex)}
        </Box>
      ))}
      {hasMore && <Text dimColor> ↓ {items.length - scrollOffset - maxVisible} more below</Text>}
    </Box>
  );
}
