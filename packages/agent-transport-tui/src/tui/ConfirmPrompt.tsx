/**
 * Reusable confirmation prompt with arrow-key selection.
 * Used by model change, permission prompts, and other yes/no confirmations.
 */

import React, { useState, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  applyConfirmPromptInput,
  getConfirmPromptInputAction,
  type TConfirmPromptInputAction,
} from './flows/confirm-prompt-flow.js';
import { createSelectionFlowState, type ISelectionFlowState } from './flows/selection-flow.js';

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
              {i === state.selectedIndex ? '> ' : '  '}
              {opt}
            </Text>
          </Box>
        ))}
      </Box>
      <Text dimColor> arrow keys to select, Enter to confirm</Text>
    </Box>
  );
}
