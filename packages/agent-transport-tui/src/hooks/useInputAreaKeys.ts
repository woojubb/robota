/**
 * The input area's three key bindings, in one place.
 *
 * Extracted from `InputArea.tsx` (CLI-2004) by responsibility: the component owns the input's state
 * and its rendering; these three `useInput` registrations are the routing between the two, and each
 * is gated on a different combination of the same flags — which is the shape that gets copied wrong
 * when it is inline among the render code.
 */

import { useInput } from 'ink';

import {
  getAutocompletePopupAction,
  getPendingPromptInputAction,
  getPromptHistoryInputAction,
  moveAutocompleteSelection,
  navigatePromptHistory,
  type IPromptHistoryNavigationState,
} from '../flows/input-area-flow.js';

import type { ICommand } from '@robota-sdk/agent-interface-command';

export interface IUseInputAreaKeysInputs {
  value: string;
  isDisabled: boolean;
  pendingPrompt?: string | null;
  showPopup: boolean;
  setShowPopup: (shown: boolean) => void;
  filteredCommands: ICommand[];
  selectedIndex: number;
  setSelectedIndex: (update: (previous: number) => number) => void;
  tabCompleteCommand: (command: ICommand) => void;
  promptHistory: string[];
  historyState: IPromptHistoryNavigationState;
  setValue: (value: string) => void;
  setCursorHint: (hint: number | null) => void;
  setHistoryState: (state: IPromptHistoryNavigationState) => void;
  onRequestFocusBackgroundList?: (() => void) | undefined;
  onCancelQueue?: (() => void) | undefined;
}

/** Register the autocomplete-popup, prompt-history and queued-prompt bindings. */
export function useInputAreaKeys(inputs: IUseInputAreaKeysInputs): void {
  const { showPopup, isDisabled, pendingPrompt, filteredCommands, selectedIndex } = inputs;

  useInput(
    (
      _input: string,
      key: { upArrow: boolean; downArrow: boolean; escape: boolean; tab: boolean },
    ) => {
      if (!showPopup) return;
      const action = getAutocompletePopupAction(key);
      if (action === 'previous' || action === 'next') {
        inputs.setSelectedIndex((previous) =>
          moveAutocompleteSelection(previous, filteredCommands.length, action),
        );
      } else if (action === 'close') {
        inputs.setShowPopup(false);
      } else if (action === 'complete') {
        const command = filteredCommands[selectedIndex];
        if (command) inputs.tabCompleteCommand(command);
      }
    },
    { isActive: showPopup && !isDisabled },
  );

  useInput(
    (_input, key) => {
      const action = getPromptHistoryInputAction(key);
      if (!action) return;
      // SCREEN-014: ↓ on an empty input that is not browsing history falls through into the
      // background-work list (where it is a no-op for the input today). The parent decides whether
      // there is a list to focus.
      if (action === 'next' && inputs.historyState.selectedIndex === null && inputs.value.length === 0) {
        inputs.onRequestFocusBackgroundList?.();
        return;
      }
      const result = navigatePromptHistory(
        inputs.value,
        inputs.promptHistory,
        inputs.historyState,
        action,
      );
      inputs.setValue(result.value);
      inputs.setCursorHint(result.cursorHint);
      inputs.setHistoryState(result.state);
    },
    { isActive: !showPopup && !isDisabled && !pendingPrompt },
  );

  // Backspace cancels queued prompt
  useInput(
    (_input, key) => {
      if (getPendingPromptInputAction(key) === 'cancelQueue' && pendingPrompt) {
        inputs.onCancelQueue?.();
      }
    },
    { isActive: !!pendingPrompt },
  );
}
