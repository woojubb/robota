import { consentScopeFor } from '@robota-sdk/agent-framework';
import { Box } from 'ink';
import React from 'react';

import {
  applyPermissionPromptInput,
  permissionPromptOptionsFor,
  type TPermissionPromptInputAction,
} from './flows/permission-prompt-flow.js';
import { createSelectionFlowState, type ISelectionFlowState } from './flows/selection-flow.js';
import { useNumberedSelection } from './hooks/useNumberedSelection.js';
import {
  KeyHintFooter,
  SELECTION_INDICATOR,
  SELECTION_INDICATOR_NONE,
  type IKeyHint,
} from './key-hint-footer.js';
import { useKeybindingActions, useKeybindingHints } from './keybindings/keybindings-context.js';
import { NumberedList } from './numbered-list.js';
import { Text } from './SafeText.js';
import { useScreenReader } from './screen-reader-context.js';
import { SCREEN_READER_LABELS } from './screen-reader-labels.js';
import { usePalette } from './theme/index.js';

import type { IPendingPermissionRequest } from './types.js';
import type { TToolArgs } from '@robota-sdk/agent-core';

interface IProps {
  request: IPendingPermissionRequest;
  /** How long a new request ignores its answer keys; tests pass their own. */
  armDelayMs?: number;
}

/**
 * The prompt replaces the composer while the user may still be typing, and its keys are ordinary
 * letters and digits (`a` allows for the session). For this long after a request appears its keys
 * answer nothing, so a keystroke meant for the composer cannot grant a permission. The prompt shows
 * no selection cursor until it is armed.
 */
export const PERMISSION_PROMPT_ARM_DELAY_MS = 450;

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

export default function PermissionPrompt({
  request,
  armDelayMs = PERMISSION_PROMPT_ARM_DELAY_MS,
}: IProps): React.ReactElement {
  const palette = usePalette();
  const canPersistProjectPermission = request.canPersistProjectPermission !== false;
  const [state, setState] = React.useState<ISelectionFlowState>(() => createSelectionFlowState());
  const stateRef = React.useRef(state);
  const prevRequestRef = React.useRef(request);

  if (prevRequestRef.current !== request) {
    prevRequestRef.current = request;
    const nextState = createSelectionFlowState();
    stateRef.current = nextState;
    setState(nextState);
  }

  const [armedRequest, setArmedRequest] = React.useState<IPendingPermissionRequest | undefined>();
  React.useEffect(() => {
    if (armDelayMs <= 0) return undefined;
    const timer = setTimeout(() => setArmedRequest(request), armDelayMs);
    return () => clearTimeout(timer);
  }, [request, armDelayMs]);
  const armed = armDelayMs <= 0 || armedRequest === request;

  const applyAction = React.useCallback(
    (action: TPermissionPromptInputAction): void => {
      const result = applyPermissionPromptInput(
        stateRef.current,
        action,
        canPersistProjectPermission,
      );
      stateRef.current = result.state;
      setState(result.state);
      if (result.effect.type === 'resolve') {
        request.resolve(result.effect.decision);
      }
    },
    [request, canPersistProjectPermission],
  );

  const screenReader = useScreenReader();
  const options = permissionPromptOptionsFor(
    consentScopeFor(request.toolName, request.toolArgs),
    canPersistProjectPermission,
  );
  const numbered = useNumberedSelection({
    // Off while arming, so a digit typed then is not buffered for a later Enter to commit.
    enabled: screenReader && armed,
    itemCount: options.length,
    onSelect: (index) => {
      const result = applyPermissionPromptInput(
        stateRef.current,
        {
          type: 'shortcut',
          index,
        },
        canPersistProjectPermission,
      );
      stateRef.current = result.state;
      setState(result.state);
      if (result.effect.type === 'resolve') request.resolve(result.effect.decision);
    },
  });
  // Digits typed for one request are not an answer to the next.
  const clearNumbered = numbered.clear;
  React.useEffect(() => clearNumbered(), [request, clearNumbered]);

  useKeybindingActions(
    'permission-prompt',
    (actions) => {
      if (!armed) return;
      const shortcutIndex = {
        'allow-once': 0,
        'allow-session': 1,
        'allow-project': 2,
        deny: 3,
      } as const;
      for (const action of actions) {
        if (action in shortcutIndex) {
          applyAction({
            type: 'shortcut',
            index: shortcutIndex[action as keyof typeof shortcutIndex],
          });
        } else if (action === 'previous' || action === 'next' || action === 'confirm') {
          applyAction(action === 'confirm' ? 'select' : action);
        }
      }
    },
    { isActive: !screenReader },
  );
  const footerHints = useKeybindingHints('permission-prompt', [
    [['previous', 'next'], 'Navigate'],
    ['confirm', 'Confirm'],
  ]);

  if (screenReader) {
    return (
      <NumberedList
        title={SCREEN_READER_LABELS.permissionRequired}
        description={`${request.toolName} — ${formatArgs(request.toolArgs)}${
          request.requestedByPeer !== undefined
            ? ` (requested by another session: ${request.requestedByPeer})`
            : ''
        }`}
        options={options}
        buffer={numbered.buffer}
        invalid={numbered.invalid}
      />
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={armed ? palette.border.attention : palette.border.muted}
      paddingX={1}
    >
      <Box>
        <Text color={palette.text.warning} bold>
          [Permission Required]
        </Text>
        {armed ? null : <Text dimColor> keys answer in a moment</Text>}
      </Box>
      <Text>
        Tool:{' '}
        <Text color={palette.text.accent} bold>
          {request.toolName}
        </Text>
      </Text>
      <Text dimColor> {formatArgs(request.toolArgs)}</Text>
      {request.requestedByPeer !== undefined ? (
        <Text color={palette.text.warning}>
          Requested by another session: {request.requestedByPeer}
        </Text>
      ) : null}
      {/* Issue #2351: the "always" options carry the consent scope, so they no longer fit one row
          of the prompt box — a row wrapped `Allow [y]` across two lines. One option per line. */}
      <Box marginTop={1} flexDirection="column">
        {options.map((opt, i) => {
          const selected = armed && i === state.selectedIndex;
          return (
            <Box key={opt}>
              <Text
                color={selected ? palette.text.accent : undefined}
                bold={selected}
                dimColor={!armed}
              >
                {selected ? SELECTION_INDICATOR : SELECTION_INDICATOR_NONE}
                {opt}
              </Text>
            </Box>
          );
        })}
      </Box>
      <KeyHintFooter hints={footerHints} />
    </Box>
  );
}
