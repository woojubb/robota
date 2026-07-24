import { Box, Text, useInput } from 'ink';
import React, { useState, useCallback, useRef } from 'react';

import {
  applySelectionInput,
  createSelectionFlowState,
  getVerticalSelectionInputAction,
  normalizeSelectionState,
  type ISelectionFlowState,
  type TSelectionInputAction,
} from './flows/selection-flow.js';
import {
  KeyHintFooter,
  SELECTION_INDICATOR,
  SELECTION_INDICATOR_NONE,
  type IKeyHint,
} from './key-hint-footer.js';

/** Footer for the interactive menu state. */
export const MENU_SELECT_FOOTER_HINTS: readonly IKeyHint[] = [
  { keys: '↑↓', label: 'Navigate' },
  { keys: 'Enter', label: 'Select' },
  { keys: 'Esc', label: 'Back' },
];

/** Footer for the error state — Esc (cancel) is the only active key. */
export const MENU_SELECT_ERROR_FOOTER_HINTS: readonly IKeyHint[] = [{ keys: 'Esc', label: 'Back' }];

export interface IMenuSelectItem {
  label: string;
  value: string;
  hint?: string;
}

interface IProps {
  title: string;
  items: IMenuSelectItem[];
  onSelect: (value: string) => void;
  onBack: () => void;
  loading?: boolean;
  error?: string;
}

export default function MenuSelect({
  title,
  items,
  onSelect,
  onBack,
  loading,
  error,
}: IProps): React.ReactElement {
  const [state, setState] = useState<ISelectionFlowState>(() => createSelectionFlowState());
  const stateRef = useRef(state);
  const isEnabled = !loading && !error;
  const applyAction = useCallback(
    (action: TSelectionInputAction): void => {
      const result = applySelectionInput(stateRef.current, action, {
        itemCount: items.length,
        enabled: isEnabled,
      });
      stateRef.current = result.state;
      setState(result.state);
      if (result.effect.type === 'cancel') {
        onBack();
      } else if (result.effect.type === 'select') {
        const item = items[result.effect.index];
        if (item !== undefined) {
          onSelect(item.value);
        }
      }
    },
    [isEnabled, items, onBack, onSelect],
  );

  useInput((input, key) => {
    const action = getVerticalSelectionInputAction(key);
    if (action !== undefined) {
      applyAction(action);
    }
  });

  const normalizedState = normalizeSelectionState(state, { itemCount: items.length });
  if (normalizedState !== state) {
    stateRef.current = normalizedState;
  }
  const selected = normalizedState.selectedIndex;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        {title}
      </Text>
      {loading && (
        <Box marginTop={1}>
          <Text dimColor>Loading...</Text>
        </Box>
      )}
      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}
      {!loading && !error && (
        <Box flexDirection="column" marginTop={1}>
          {items.map((item, i) => (
            <Box key={item.value}>
              <Text color={i === selected ? 'cyan' : undefined} bold={i === selected}>
                {i === selected ? SELECTION_INDICATOR : SELECTION_INDICATOR_NONE}
                {item.label}
              </Text>
              {item.hint && <Text dimColor> {item.hint}</Text>}
            </Box>
          ))}
        </Box>
      )}
      <KeyHintFooter
        hints={loading ? [] : error ? MENU_SELECT_ERROR_FOOTER_HINTS : MENU_SELECT_FOOTER_HINTS}
      />
    </Box>
  );
}
