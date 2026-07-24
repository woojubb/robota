import { Box, Text, useInput } from 'ink';
import React, { useState, useRef, useCallback } from 'react';

import {
  applyTextPromptInput,
  createTextPromptFlowState,
  getTextPromptInputAction,
  type ITextPromptFlowState,
  type TTextPromptInputAction,
} from './flows/text-prompt-flow.js';
import { KeyHintFooter, type IKeyHint } from './key-hint-footer.js';
import { PALETTE } from './tui-palette.js';

/** Footer for the free-text prompt. */
export const TEXT_PROMPT_FOOTER_HINTS: readonly IKeyHint[] = [
  { keys: 'Enter', label: 'Submit' },
  { keys: 'Esc', label: 'Cancel' },
];

interface IProps {
  title: string;
  description?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  validate?: (value: string) => string | undefined;
  allowEmpty?: boolean;
  masked?: boolean;
}

export default function TextPrompt({
  title,
  description,
  placeholder,
  onSubmit,
  onCancel,
  validate,
  allowEmpty = false,
  masked = false,
}: IProps): React.ReactElement {
  const [state, setState] = useState<ITextPromptFlowState>(() => createTextPromptFlowState());
  const stateRef = useRef(state);
  const applyAction = useCallback(
    (action: TTextPromptInputAction): void => {
      const result = applyTextPromptInput(stateRef.current, action, { allowEmpty, validate });
      stateRef.current = result.state;
      setState(result.state);
      if (result.effect.type === 'cancel') {
        onCancel();
      } else if (result.effect.type === 'submit') {
        onSubmit(result.effect.value);
      }
    },
    [allowEmpty, validate, onCancel, onSubmit],
  );

  useInput((input, key) => {
    const action = getTextPromptInputAction(input, key);
    if (action !== undefined) applyAction(action);
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={PALETTE.border.attention}
      paddingX={1}
    >
      <Text color={PALETTE.text.warning} bold>
        {title}
      </Text>
      <PromptDescription description={description} />
      <Box marginTop={1}>
        <Text color={PALETTE.text.accent}>&gt; </Text>
        {state.value ? (
          <Text>{masked ? '*'.repeat(state.value.length) : state.value}</Text>
        ) : placeholder ? (
          <Text dimColor>{placeholder}</Text>
        ) : null}
        <Text color={PALETTE.text.accent}>█</Text>
      </Box>
      {state.error && <Text color={PALETTE.text.error}>{state.error}</Text>}
      <KeyHintFooter hints={TEXT_PROMPT_FOOTER_HINTS} />
    </Box>
  );
}

function PromptDescription({ description }: { description?: string }): React.ReactElement | null {
  if (description === undefined || description.length === 0) {
    return null;
  }

  return <Text dimColor>{description}</Text>;
}
