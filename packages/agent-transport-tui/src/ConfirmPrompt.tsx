/**
 * Reusable confirmation prompt with arrow-key selection.
 * Used by model change, permission prompts, and other yes/no confirmations.
 */

import { Box, useInput } from 'ink';
import React, { useState, useRef, useCallback } from 'react';

import {
  applyConfirmPromptInput,
  applyTypedConfirmInput,
  createTypedConfirmState,
  getConfirmPromptInputAction,
  type ITypedConfirmState,
  type TConfirmPromptInputAction,
} from './flows/confirm-prompt-flow.js';
import { createSelectionFlowState, type ISelectionFlowState } from './flows/selection-flow.js';
import {
  KeyHintFooter,
  SELECTION_INDICATOR,
  SELECTION_INDICATOR_NONE,
  type IKeyHint,
} from './key-hint-footer.js';
import { Text } from './SafeText.js';
import { useScreenReader } from './screen-reader-context.js';
import { PALETTE } from './tui-palette.js';

/** The typed-answer prompt. Authored here beside the reducer that accepts it. */
export const CONFIRM_PROMPT_TYPED_LITERAL = 'Answer y or n and press Enter';

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

  const screenReader = useScreenReader();
  const [typed, setTyped] = useState<ITypedConfirmState>(createTypedConfirmState);
  const typedRef = useRef(typed);

  useInput(
    (input, key) => {
      const result = applyTypedConfirmInput(typedRef.current, input, key);
      typedRef.current = result.state;
      setTyped(result.state);
      if (result.effect.type === 'select') onSelect(result.effect.index);
    },
    { isActive: screenReader },
  );

  useInput(
    (input, key) => {
      const action = getConfirmPromptInputAction(input, key, options.length);
      if (action !== undefined) {
        applyAction(action);
      }
    },
    { isActive: !screenReader },
  );

  if (screenReader) {
    return (
      <Box flexDirection="column">
        <Text>{message}</Text>
        <Text>
          {CONFIRM_PROMPT_TYPED_LITERAL}
          {typed.buffer.length > 0 ? ` ${typed.buffer}` : ''}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={PALETTE.border.attention}
      paddingX={1}
    >
      <Text color={PALETTE.text.warning}>{message}</Text>
      <Box marginTop={1}>
        {options.map((opt, i) => (
          <Box key={opt} marginRight={2}>
            <Text
              color={i === state.selectedIndex ? PALETTE.text.accent : undefined}
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
