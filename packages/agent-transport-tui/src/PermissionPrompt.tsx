import { Box, Text, useInput } from 'ink';
import React from 'react';

import {
  applyPermissionPromptInput,
  getPermissionPromptInputAction,
  PERMISSION_PROMPT_OPTIONS,
  type TPermissionPromptInputAction,
} from './flows/permission-prompt-flow.js';
import { createSelectionFlowState, type ISelectionFlowState } from './flows/selection-flow.js';
import {
  KeyHintFooter,
  SELECTION_INDICATOR,
  SELECTION_INDICATOR_NONE,
  type IKeyHint,
} from './key-hint-footer.js';
import { PALETTE } from './tui-palette.js';

import type { IPendingPermissionRequest } from './types.js';
import type { TToolArgs } from '@robota-sdk/agent-core';

interface IProps {
  request: IPendingPermissionRequest;
}

/**
 * Footer for the permission prompt — identical to the confirm prompt's (same horizontal row, same
 * reducer). Esc is deliberately suppressed by the flow (`escape: false` — a permission ask must
 * resolve explicitly; Esc-dismissal would be an implicit deny), so the footer omits it.
 */
export const PERMISSION_PROMPT_FOOTER_HINTS: readonly IKeyHint[] = [
  { keys: '←→', label: 'Navigate' },
  { keys: 'Enter', label: 'Confirm' },
];

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
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={PALETTE.border.attention}
      paddingX={1}
    >
      <Text color={PALETTE.text.warning} bold>
        [Permission Required]
      </Text>
      <Text>
        Tool:{' '}
        <Text color={PALETTE.text.accent} bold>
          {request.toolName}
        </Text>
      </Text>
      <Text dimColor> {formatArgs(request.toolArgs)}</Text>
      <Box marginTop={1}>
        {PERMISSION_PROMPT_OPTIONS.map((opt, i) => (
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
      <KeyHintFooter hints={PERMISSION_PROMPT_FOOTER_HINTS} />
    </Box>
  );
}
