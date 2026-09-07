/**
 * Generic list picker with arrow-key navigation and viewport scrolling.
 * Renders items via a user-supplied renderItem function.
 * Shows a limited number of items at a time; scrolls as the cursor moves.
 */

import { Box, useInput } from 'ink';
import React, { useState, useRef, useCallback } from 'react';

import {
  applySelectionInput,
  createSelectionFlowState,
  getVerticalSelectionInputAction,
  normalizeSelectionState,
  type ISelectionFlowState,
  type TSelectionInputAction,
} from './flows/selection-flow.js';
import { useNumberedSelection } from './hooks/useNumberedSelection.js';
import { KeyHintFooter, type IKeyHint } from './key-hint-footer.js';
import { formatNumberedSelectionPrompt, numberedRowPrefix } from './numbered-list.js';
import { Text } from './SafeText.js';
import { useScreenReader } from './screen-reader-context.js';

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
  /** Key-hint footer shown below the list (default: navigate/select/cancel; `[]` suppresses it) */
  footerHints?: readonly IKeyHint[];
}

/** Default affordance footer — Enter always selects and Esc always cancels. */
export const LIST_PICKER_DEFAULT_FOOTER_HINTS: readonly IKeyHint[] = [
  { keys: '↑↓', label: 'Navigate' },
  { keys: 'Enter', label: 'Select' },
  { keys: 'Esc', label: 'Cancel' },
];

export default function ListPicker<T>({
  items,
  renderItem,
  onSelect,
  onCancel,
  maxVisible = DEFAULT_MAX_VISIBLE,
  footerHints = LIST_PICKER_DEFAULT_FOOTER_HINTS,
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

  // CLI-2004: the viewport is a sighted affordance — `↑ N more above` tells a reader nothing about
  // where it is. The mode lists every item with its number and asks for one.
  const screenReader = useScreenReader();
  const numbered = useNumberedSelection({
    enabled: screenReader && items.length > 0,
    itemCount: items.length,
    cancellable: true,
    onSelect: (index) => {
      const item = items[index];
      if (item !== undefined) onSelect(item);
    },
    onCancel,
  });

  useInput(
    (_input, key) => {
      const action = getVerticalSelectionInputAction(key);
      if (action !== undefined) {
        applyAction(action);
      }
    },
    { isActive: !screenReader },
  );

  if (items.length === 0) {
    return <Box />;
  }

  if (screenReader) {
    const prompt = formatNumberedSelectionPrompt(items.length, true);
    return (
      <Box flexDirection="column">
        {items.map((item, index) => (
          <Box key={index}>
            <Text>{numberedRowPrefix(index)}</Text>
            {renderItem(item, false)}
          </Box>
        ))}
        <Text>
          {prompt}
          {numbered.buffer.length > 0 ? ` ${numbered.buffer}` : ''}
        </Text>
        {numbered.invalid && <Text>{prompt}</Text>}
      </Box>
    );
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
      <KeyHintFooter hints={footerHints} />
    </Box>
  );
}
