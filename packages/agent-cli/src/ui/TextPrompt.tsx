import React, { useState, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  applyTextPromptInput,
  createTextPromptFlowState,
  getTextPromptInputAction,
  type ITextPromptFlowState,
  type TTextPromptInputAction,
} from './flows/text-prompt-flow.js';

interface IProps {
  title: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  validate?: (value: string) => string | undefined;
  allowEmpty?: boolean;
  masked?: boolean;
}

export default function TextPrompt({
  title,
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
    if (action !== undefined) {
      applyAction(action);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        {title}
      </Text>
      <Box marginTop={1}>
        <Text color="cyan">&gt; </Text>
        {state.value ? (
          <Text>{masked ? '*'.repeat(state.value.length) : state.value}</Text>
        ) : placeholder ? (
          <Text dimColor>{placeholder}</Text>
        ) : null}
        <Text color="cyan">█</Text>
      </Box>
      {state.error && <Text color="red">{state.error}</Text>}
      <Text dimColor> Enter Submit Esc Cancel</Text>
    </Box>
  );
}
