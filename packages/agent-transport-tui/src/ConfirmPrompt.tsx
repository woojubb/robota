/**
 * Reusable confirmation prompt with arrow-key selection.
 * Used by model change, permission prompts, and other yes/no confirmations.
 */

import { Box, Text, useInput } from 'ink';
import React, { useState, useRef, useCallback } from 'react';

import {
  applyConfirmPromptInput,
  getConfirmPromptInputAction,
  type TConfirmPromptInputAction,
} from './flows/confirm-prompt-flow.js';
import { createSelectionFlowState, type ISelectionFlowState } from './flows/selection-flow.js';
import {
  KeyHintFooter,
  SELECTION_INDICATOR,
  SELECTION_INDICATOR_NONE,
  type IKeyHint,
} from './key-hint-footer.js';

/**
 * Footer for the confirm prompt. Names the canonical keys for a horizontal row (←→; the reducer
 * also accepts ↑↓ as aliases). Esc is deliberately suppressed by the flow (`escape: false` — the
 * prompt must resolve explicitly), so per the affordance contract the footer omits it.
 */
export const CONFIRM_PROMPT_FOOTER_HINTS: readonly IKeyHint[] = [
  { keys: '←→', label: 'Navigate' },
  { keys: 'Enter', label: 'Confirm' },
];

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
  const [state, setState] = useState<ISelectionFlowState>(() => createSelectionFlowState());
  const stateRef = useRef(state);
  const applyAction = useCallback(
    (action: TConfirmPromptInputAction): void => {
      const result = applyConfirmPromptInput(stateRef.current, action, options.length);
      stateRef.current = result.state;
      setState(result.state);
      if (result.effect.type === 'select') {
        onSelect(result.effect.index);
      }
    },
    [onSelect, options.length],
  );

  useInput((input, key) => {
    const action = getConfirmPromptInputAction(input, key, options.length);
    if (action !== undefined) {
      applyAction(action);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">{message}</Text>
      <Box marginTop={1}>
        {options.map((opt, i) => (
          <Box key={opt} marginRight={2}>
            <Text
              color={i === state.selectedIndex ? 'cyan' : undefined}
              bold={i === state.selectedIndex}
            >
              {i === state.selectedIndex ? SELECTION_INDICATOR : SELECTION_INDICATOR_NONE}
              {opt}
            </Text>
          </Box>
        ))}
      </Box>
      <KeyHintFooter hints={CONFIRM_PROMPT_FOOTER_HINTS} />
    </Box>
  );
}
