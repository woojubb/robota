import { Box, useWindowSize } from 'ink';
import React, { useState, useCallback, useRef, useMemo } from 'react';

import CjkTextInput from './CjkTextInput.js';
import {
  appendPromptHistory,
  createPasteLabelChange,
  createPromptHistoryNavigationState,
  extractPromptHistory,
  resolveEnterCommandSelection,
  resolveTabCompletion,
  shouldSubmitInput,
} from './flows/input-area-flow.js';
import HistorySearchOverlay from './HistorySearchOverlay.js';
import { useAutocomplete } from './hooks/useAutocomplete.js';
import { useInputAreaHistorySearch } from './hooks/useInputAreaHistorySearch.js';
import { useInputAreaKeys } from './hooks/useInputAreaKeys.js';
import { DeletionAnnouncement, InputBottomRule, InputTopRule } from './input-area-rules.js';
import { KeyHintFooter } from './key-hint-footer.js';
import { useKeybindingHints } from './keybindings/keybindings-context.js';
import { Text } from './SafeText.js';
import { useScreenReader } from './screen-reader-context.js';
import SlashAutocomplete from './SlashAutocomplete.js';
import { PALETTE } from './tui-palette.js';
import { expandPasteLabels } from './utils/paste-labels.js';
import WaveText from './WaveText.js';

import type { IInputAreaHistorySearch } from './hooks/useInputAreaHistorySearch.js';
import type { ITuiCommandQueryPort } from './tui-app-channel-port.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { ICommand } from '@robota-sdk/agent-interface-command';

const PENDING_PROMPT_DISPLAY_MAX = 50;
const PENDING_PROMPT_TAIL_KEEP = 47;

interface IProps {
  onSubmit: (value: string) => void;
  onCancelQueue?: () => void;
  isDisabled: boolean;
  isQueueCancellationDisabled?: boolean;
  isAborting?: boolean;
  pendingPrompt?: string | null;
  /** REMOTE-014 E5: total queued turns (owner + co-drivers); >1 surfaces a co-driver-queued hint. */
  pendingCount?: number;
  commandQueryPort?: ITuiCommandQueryPort;
  sessionName?: string;
  history?: readonly IHistoryEntry[];
  /**
   * SCREEN-014: called when ↓ is pressed on an empty input at the bottom of prompt history, so the
   * parent can move focus into the background-work list (a no-op for the input today).
   */
  onRequestFocusBackgroundList?: () => void;
  /** SCREEN-1993: the stored-prompt search surface; absent ⇒ `ctrl+r` is inert. */
  historySearch?: IInputAreaHistorySearch | undefined;
}

/**
 * Known limitation: Korean IME last character may be dropped on Enter.
 * This is an Ink raw mode limitation — no compositionstart/compositionend
 * events are available in terminal raw mode.
 * Reference: https://github.com/anthropics/claude-code/issues/3045
 */
/**
 * Layout constants for InputArea (columns).
 * Used to compute available text width from terminal columns.
 *
 * Side borders removed — only top/bottom horizontal lines remain.
 * paddingLeft={1} adds 1 column inside the box.
 * Prompt "> " takes 2 columns.
 */
const BORDER_HORIZONTAL = 0;
const PADDING_LEFT = 1;
const PROMPT_WIDTH = 2;
const INPUT_AREA_OVERHEAD = BORDER_HORIZONTAL + PADDING_LEFT + PROMPT_WIDTH;
const DEFAULT_TERMINAL_COLUMNS = 80;

export default function InputArea({
  onSubmit,
  onCancelQueue,
  isDisabled,
  isQueueCancellationDisabled,
  isAborting,
  pendingPrompt,
  pendingCount,
  commandQueryPort,
  sessionName,
  history,
  onRequestFocusBackgroundList,
  historySearch,
}: IProps): React.ReactElement {
  const [value, setValue] = useState('');
  const [cursorHint, setCursorHint] = useState<number | null>(null);
  // CLI-2004: the text the last word/line delete removed, announced once and cleared on the next
  // ordinary edit. A reader announces the line it is ON — what left it is otherwise unrecoverable.
  const screenReader = useScreenReader();
  const [deletedText, setDeletedText] = useState<string | null>(null);
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
  const submitHint = useKeybindingHints('chat-input', [['submit', 'Submit']]);

  const {
    showPopup,
    filteredCommands,
    selectedIndex,
    setSelectedIndex,
    isSubcommandMode,
    setShowPopup,
  } = useAutocomplete(value, commandQueryPort);

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
      if (result.type === 'submit') {
        setValue('');
        submitPrompt(result.value);
      }
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

  const search = useInputAreaHistorySearch({
    historySearch,
    sessionPrompts: promptHistory,
    composerActive: !showPopup && !isDisabled && !pendingPrompt,
    setValue,
    setCursorHint,
    submitPrompt,
  });

  useInputAreaKeys({
    value,
    isDisabled,
    searchOpen: search.open,
    isQueueCancellationDisabled: isQueueCancellationDisabled ?? isDisabled,
    pendingPrompt,
    showPopup,
    setShowPopup,
    filteredCommands,
    selectedIndex,
    setSelectedIndex,
    tabCompleteCommand,
    promptHistory,
    historyState,
    setValue,
    setCursorHint,
    setHistoryState,
    onRequestFocusBackgroundList,
    onCancelQueue,
  });

  const borderColor = isAborting
    ? PALETTE.border.attention
    : pendingPrompt
      ? PALETTE.border.focused
      : isDisabled
        ? PALETTE.border.muted
        : PALETTE.border.active;
  const innerWidth = Math.max(1, terminalColumns - BORDER_HORIZONTAL);

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
      <HistorySearchOverlay view={search} />
      <DeletionAnnouncement deleted={screenReader ? deletedText : null} />
      <InputTopRule
        screenReader={screenReader}
        innerWidth={innerWidth}
        borderColor={borderColor}
        {...(sessionName !== undefined ? { sessionName } : {})}
      />
      <Box paddingLeft={1}>
        {isAborting ? (
          <Text color={PALETTE.text.warning}> Interrupting...</Text>
        ) : pendingPrompt ? (
          <Text color={PALETTE.text.accent}>
            {' '}
            Queued:{' '}
            {pendingPrompt.length > PENDING_PROMPT_DISPLAY_MAX
              ? pendingPrompt.slice(0, PENDING_PROMPT_TAIL_KEEP) + '...'
              : pendingPrompt}{' '}
            {typeof pendingCount === 'number' && pendingCount > 1 && (
              <Text dimColor>(+{pendingCount - 1} co-driver queued) </Text>
            )}
            <Text dimColor>(Backspace to cancel)</Text>
          </Text>
        ) : isDisabled ? (
          <WaveText text="  Waiting for response... (ESC to interrupt)" />
        ) : (
          <Box>
            <Text color={PALETTE.text.success} bold>
              {'> '}
            </Text>
            <CjkTextInput
              value={value}
              onChange={(v) => {
                setValue(v);
                resetHistoryNavigation();
                setCursorHint(null); // reset after normal typing
              }}
              onDeletedText={setDeletedText}
              onSubmit={handleSubmit}
              onPaste={handlePaste}
              placeholder="Type a message or /help"
              availableWidth={availableWidth}
              cursorHint={cursorHint}
              enableVerticalNavigation={false}
              keybindingContext={showPopup ? 'autocomplete-menu' : 'chat-input'}
              focus={!search.open}
            />
          </Box>
        )}
      </Box>
      {!screenReader && !isDisabled && !pendingPrompt && !search.open && (
        <KeyHintFooter hints={submitHint} />
      )}
      <InputBottomRule
        screenReader={screenReader}
        innerWidth={innerWidth}
        borderColor={borderColor}
      />
    </Box>
  );
}
