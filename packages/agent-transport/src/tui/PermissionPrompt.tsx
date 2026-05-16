import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { IPermissionRequest } from './types.js';
import type { TToolArgs } from '@robota-sdk/agent-core';
import {
  applyPermissionPromptInput,
  getPermissionPromptInputAction,
  PERMISSION_PROMPT_OPTIONS,
  type TPermissionPromptInputAction,
} from './flows/permission-prompt-flow.js';
import { createSelectionFlowState, type ISelectionFlowState } from './flows/selection-flow.js';

interface IProps {
  request: IPermissionRequest;
}

function formatArgs(args: TToolArgs): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '(no arguments)';
  return entries
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ');
}

export default function PermissionPrompt({ request }: IProps): React.ReactElement {
  const [state, setState] = React.useState<ISelectionFlowState>(() => createSelectionFlowState());
  const stateRef = React.useRef(state);
  const prevRequestRef = React.useRef(request);

  if (prevRequestRef.current !== request) {
    prevRequestRef.current = request;
    const nextState = createSelectionFlowState();
    stateRef.current = nextState;
    setState(nextState);
  }

  const applyAction = React.useCallback(
    (action: TPermissionPromptInputAction): void => {
      const result = applyPermissionPromptInput(stateRef.current, action);
      stateRef.current = result.state;
      setState(result.state);
      if (result.effect.type === 'resolve') {
        request.resolve(result.effect.decision);
      }
    },
    [request],
  );

  useInput((input, key) => {
    const action = getPermissionPromptInputAction(input, key);
    if (action !== undefined) {
      applyAction(action);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        [Permission Required]
      </Text>
      <Text>
        Tool:{' '}
        <Text color="cyan" bold>
          {request.toolName}
        </Text>
      </Text>
      <Text dimColor> {formatArgs(request.toolArgs)}</Text>
      <Box marginTop={1}>
        {PERMISSION_PROMPT_OPTIONS.map((opt, i) => (
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
      <Text dimColor> left/right to select, Enter to confirm</Text>
    </Box>
  );
}
