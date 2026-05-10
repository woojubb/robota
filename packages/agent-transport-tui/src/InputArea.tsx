import React, { useState, useCallback, useRef, useMemo } from 'react';

const PENDING_PROMPT_DISPLAY_MAX = 50;
const PENDING_PROMPT_TAIL_KEEP = 47;
import { Box, Text, useInput, useWindowSize } from 'ink';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { CommandRegistry, ICommand } from '@robota-sdk/agent-sdk';
import CjkTextInput from './CjkTextInput.js';
import WaveText from './WaveText.js';
import SlashAutocomplete from './SlashAutocomplete.js';
import { expandPasteLabels } from './utils/paste-labels.js';
import { useAutocomplete } from './hooks/useAutocomplete.js';
import {
  appendPromptHistory,
  createPasteLabelChange,
  createPromptHistoryNavigationState,
  extractPromptHistory,
  getAutocompletePopupAction,
  getPendingPromptInputAction,
  getPromptHistoryInputAction,
  moveAutocompleteSelection,
  navigatePromptHistory,
  resolveEnterCommandSelection,
  resolveTabCompletion,
  shouldSubmitInput,
} from './flows/input-area-flow.js';

interface IProps {
  onSubmit: (value: string) => void;
  onCancelQueue?: () => void;
  isDisabled: boolean;
  isAborting?: boolean;
  pendingPrompt?: string | null;
  registry?: CommandRegistry;
  sessionName?: string;
  history?: readonly IHistoryEntry[];
}

/**
 * Known limitation: Korean IME last character may be dropped on Enter.
 * This is an Ink raw mode limitation — no compositionstart/compositionend
 * events are available in terminal raw mode.
 * Reference: https://github.com/anthropics/claude-code/issues/3045
 */
/**
 * Layout constants for InputArea border box (columns).
 * Used to compute available text width from terminal columns.
 *
 * Box borderStyle="single" adds 1 column per side (left + right).
 * paddingLeft={1} adds 1 column inside the box.
 * Prompt "> " takes 2 columns.
 */
const BORDER_HORIZONTAL = 2;
const PADDING_LEFT = 1;
const PROMPT_WIDTH = 2;
const INPUT_AREA_OVERHEAD = BORDER_HORIZONTAL + PADDING_LEFT + PROMPT_WIDTH;
const DEFAULT_TERMINAL_COLUMNS = 80;

export default function InputArea({
  onSubmit,
  onCancelQueue,
  isDisabled,
  isAborting,
  pendingPrompt,
  registry,
  sessionName,
  history,
}: IProps): React.ReactElement {
  const [value, setValue] = useState('');
  const [cursorHint, setCursorHint] = useState<number | null>(null);
  const [historyState, setHistoryState] = useState(createPromptHistoryNavigationState);
  const [localPromptHistory, setLocalPromptHistory] = useState<string[]>([]);
  const restoredPromptHistory = useMemo(() => extractPromptHistory(history ?? []), [history]);
  const promptHistory = useMemo(
    () =>
      localPromptHistory.reduce<string[]>(
        (prompts, prompt) => appendPromptHistory(prompts, prompt),
        restoredPromptHistory,
      ),
    [restoredPromptHistory, localPromptHistory],
  );
  const pasteStore = useRef<Map<number, string>>(new Map());
  const { columns } = useWindowSize();
  const terminalColumns = columns > 0 ? columns : DEFAULT_TERMINAL_COLUMNS;
  const availableWidth = Math.max(1, terminalColumns - INPUT_AREA_OVERHEAD);
  const pasteIdRef = useRef(0);

  const {
    showPopup,
    filteredCommands,
    selectedIndex,
    setSelectedIndex,
    isSubcommandMode,
    setShowPopup,
  } = useAutocomplete(value, registry);

  const handlePaste = useCallback((text: string, cursorPosition: number) => {
    pasteIdRef.current += 1;
    const id = pasteIdRef.current;
    pasteStore.current.set(id, text);
    setValue((prev) => {
      const change = createPasteLabelChange(prev, cursorPosition, id, text);
      setCursorHint(change.cursorHint);
      return change.value;
    });
  }, []);

  const resetHistoryNavigation = useCallback(() => {
    setHistoryState(createPromptHistoryNavigationState());
  }, []);

  const recordPromptHistory = useCallback((prompt: string): void => {
    setLocalPromptHistory((prev) => appendPromptHistory(prev, prompt));
  }, []);

  const submitPrompt = useCallback(
    (prompt: string): void => {
      recordPromptHistory(prompt);
      resetHistoryNavigation();
      onSubmit(prompt);
    },
    [onSubmit, recordPromptHistory, resetHistoryNavigation],
  );

  /** Tab: insert command into input field without executing */
  const tabCompleteCommand = useCallback(
    (cmd: ICommand): void => {
      const result = resolveTabCompletion(value, cmd);
      if (result.type === 'insert') {
        setValue(result.value);
        if (result.selectedIndex !== undefined) {
          setSelectedIndex(result.selectedIndex);
        }
      }
    },
    [value, setSelectedIndex],
  );

  /** Enter: insert and execute command immediately */
  const enterSelectCommand = useCallback(
    (cmd: ICommand): void => {
      const result = resolveEnterCommandSelection(value, cmd);
      if (result.type === 'insert') {
        setValue(result.value);
        if (result.selectedIndex !== undefined) {
          setSelectedIndex(result.selectedIndex);
        }
        return;
      }
      setValue('');
      submitPrompt(result.value);
    },
    [value, submitPrompt, setSelectedIndex],
  );

  const handleSubmit = useCallback(
    (text: string): void => {
      if (!shouldSubmitInput(text)) return;

      if (showPopup && filteredCommands[selectedIndex]) {
        enterSelectCommand(filteredCommands[selectedIndex]);
        return;
      }

      // Expand paste labels before submitting
      const expanded = expandPasteLabels(text.trim(), pasteStore.current);

      setValue('');
      // Reset paste state
      pasteStore.current.clear();
      pasteIdRef.current = 0;

      submitPrompt(expanded);
    },
    [showPopup, filteredCommands, selectedIndex, enterSelectCommand, submitPrompt],
  );

  useInput(
    (
      _input: string,
      key: { upArrow: boolean; downArrow: boolean; escape: boolean; tab: boolean },
    ) => {
      if (!showPopup) return;
      const action = getAutocompletePopupAction(key);
      if (action === 'previous' || action === 'next') {
        setSelectedIndex((prev) =>
          moveAutocompleteSelection(prev, filteredCommands.length, action),
        );
      } else if (action === 'close') {
        setShowPopup(false);
      } else if (action === 'complete') {
        const cmd = filteredCommands[selectedIndex];
        if (cmd) tabCompleteCommand(cmd);
      }
    },
    { isActive: showPopup && !isDisabled },
  );

  useInput(
    (_input, key) => {
      const action = getPromptHistoryInputAction(key);
      if (!action) return;
      const result = navigatePromptHistory(value, promptHistory, historyState, action);
      setValue(result.value);
      setCursorHint(result.cursorHint);
      setHistoryState(result.state);
    },
    { isActive: !showPopup && !isDisabled && !pendingPrompt },
  );

  // Backspace cancels queued prompt
  useInput(
    (_input, key) => {
      if (getPendingPromptInputAction(key) === 'cancelQueue' && pendingPrompt) {
        onCancelQueue?.();
      }
    },
    { isActive: !!pendingPrompt },
  );

  const borderColor = isAborting
    ? 'yellow'
    : pendingPrompt
      ? 'cyan'
      : isDisabled
        ? 'gray'
        : 'green';
  const innerWidth = Math.max(1, terminalColumns - BORDER_HORIZONTAL);

  // Build top border with optional session name title (right-aligned, 2 chars from edge)
  const topBorder = (() => {
    if (sessionName) {
      const label = ` "${sessionName}" `;
      const rightPad = 2;
      const leftLen = Math.max(0, innerWidth - label.length - rightPad);
      return { left: '┌' + '─'.repeat(leftLen), label, right: '─'.repeat(rightPad) + '┐' };
    }
    return { left: '┌' + '─'.repeat(innerWidth), label: '', right: '┐' };
  })();

  return (
    <Box flexDirection="column">
      {showPopup && (
        <SlashAutocomplete
          commands={filteredCommands}
          selectedIndex={selectedIndex}
          visible={showPopup}
          isSubcommandMode={isSubcommandMode}
        />
      )}
      <Text color={borderColor}>
        {topBorder.left}
        {topBorder.label ? (
          <Text backgroundColor={borderColor} color="black" bold>
            {topBorder.label}
          </Text>
        ) : null}
        {topBorder.right}
      </Text>
      <Box borderStyle="single" borderTop={false} borderColor={borderColor} paddingLeft={1}>
        {isAborting ? (
          <Text color="yellow"> Interrupting...</Text>
        ) : pendingPrompt ? (
          <Text color="cyan">
            {' '}
            Queued:{' '}
            {pendingPrompt.length > PENDING_PROMPT_DISPLAY_MAX
              ? pendingPrompt.slice(0, PENDING_PROMPT_TAIL_KEEP) + '...'
              : pendingPrompt}{' '}
            <Text dimColor>(Backspace to cancel)</Text>
          </Text>
        ) : isDisabled ? (
          <WaveText text="  Waiting for response... (ESC to interrupt)" />
        ) : (
          <Box>
            <Text color="green" bold>
              {'> '}
            </Text>
            <CjkTextInput
              value={value}
              onChange={(v) => {
                setValue(v);
                resetHistoryNavigation();
                setCursorHint(null); // reset after normal typing
              }}
              onSubmit={handleSubmit}
              onPaste={handlePaste}
              placeholder="Type a message or /help"
              availableWidth={availableWidth}
              cursorHint={cursorHint}
              enableVerticalNavigation={false}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
