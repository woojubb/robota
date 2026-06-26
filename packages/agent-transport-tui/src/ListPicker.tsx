/**
 * Generic list picker with arrow-key navigation and viewport scrolling.
 * Renders items via a user-supplied renderItem function.
 * Shows a limited number of items at a time; scrolls as the cursor moves.
 */

import { Box, Text, useInput } from 'ink';
import React, { useState, useRef, useCallback } from 'react';

import {
  applySelectionInput,
  createSelectionFlowState,
  getVerticalSelectionInputAction,
  normalizeSelectionState,
  type ISelectionFlowState,
  type TSelectionInputAction,
} from './flows/selection-flow.js';

/** Default number of visible items */
const DEFAULT_MAX_VISIBLE = 3;

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
  /** Key-hint footer shown below the list (default: navigate/select/cancel hint) */
  footerHint?: string;
}

/** Default affordance footer — Enter always selects and Esc always cancels. */
const DEFAULT_FOOTER_HINT = ' ↑↓ Navigate  Enter Select  Esc Cancel';

export default function ListPicker<T>({
  items,
  renderItem,
  onSelect,
  onCancel,
  maxVisible = DEFAULT_MAX_VISIBLE,
  footerHint = DEFAULT_FOOTER_HINT,
}: IListPickerProps<T>): React.ReactElement {
  const [state, setState] = useState<ISelectionFlowState>(() => createSelectionFlowState());
  const stateRef = useRef(state);
  const applyAction = useCallback(
    (action: TSelectionInputAction): void => {
      const result = applySelectionInput(stateRef.current, action, {
        itemCount: items.length,
        maxVisible,
      });
      stateRef.current = result.state;
      setState(result.state);
      if (result.effect.type === 'cancel') {
        onCancel();
      } else if (result.effect.type === 'select') {
        const item = items[result.effect.index];
        if (item !== undefined) {
          onSelect(item);
        }
      }
    },
    [items, maxVisible, onCancel, onSelect],
  );

  useInput((_input, key) => {
    const action = getVerticalSelectionInputAction(key);
    if (action !== undefined) {
      applyAction(action);
    }
  });

  if (items.length === 0) {
    return <Box />;
  }

  const normalizedState = normalizeSelectionState(state, { itemCount: items.length, maxVisible });
  if (normalizedState !== state) {
    stateRef.current = normalizedState;
  }
  const { selectedIndex, scrollOffset } = normalizedState;
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
      {footerHint !== '' && <Text dimColor>{footerHint}</Text>}
    </Box>
  );
}
