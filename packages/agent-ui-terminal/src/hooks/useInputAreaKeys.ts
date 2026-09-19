/**
 * The input area's three key bindings, in one place.
 *
 * Extracted from `InputArea.tsx` (CLI-2004) by responsibility: the component owns the input's state
 * and its rendering; these three `useInput` registrations are the routing between the two, and each
 * is gated on a different combination of the same flags — which is the shape that gets copied wrong
 * when it is inline among the render code.
 */

import {
  moveAutocompleteSelection,
  navigatePromptHistory,
  type IPromptHistoryNavigationState,
} from '../flows/input-area-flow.js';
import { useKeybindingActions } from '../keybindings/keybindings-context.js';

import type { ICommand } from '@robota-sdk/agent-interface-command';

export interface IUseInputAreaKeysInputs {
  value: string;
  isDisabled: boolean;
  /** SCREEN-1993: the history-search overlay owns the keys while it is open. */
  searchOpen: boolean;
  isQueueCancellationDisabled: boolean;
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

/** The autocomplete popup's own keys: move the selection, close it, or take the completion. */
function useAutocompletePopupKeys(inputs: IUseInputAreaKeysInputs): void {
  const { showPopup, isDisabled, filteredCommands, selectedIndex } = inputs;
  useKeybindingActions(
    'autocomplete-menu',
    (actions) => {
      if (!showPopup) return;
      for (const action of actions) {
        if (action === 'previous' || action === 'next') {
          inputs.setSelectedIndex((previous) =>
            moveAutocompleteSelection(previous, filteredCommands.length, action),
          );
        } else if (action === 'close') {
          inputs.setShowPopup(false);
        } else if (action === 'accept') {
          const command = filteredCommands[selectedIndex];
          if (command) inputs.tabCompleteCommand(command);
        }
      }
    },
    { isActive: showPopup && !isDisabled },
  );
}

/** Register the autocomplete-popup, prompt-history and queued-prompt bindings. */
export function useInputAreaKeys(inputs: IUseInputAreaKeysInputs): void {
  const { showPopup, isDisabled, isQueueCancellationDisabled, pendingPrompt, searchOpen } = inputs;

  useAutocompletePopupKeys(inputs);

  useKeybindingActions(
    'chat-input',
    (actions) => {
      const action = actions.find(
        (candidate): candidate is 'history-previous' | 'history-next' =>
          candidate === 'history-previous' || candidate === 'history-next',
      );
      if (action === undefined) return;
      const direction = action === 'history-previous' ? 'previous' : 'next';
      // SCREEN-014: ↓ on an empty input that is not browsing history falls through into the
      // background-work list (where it is a no-op for the input today). The parent decides whether
      // there is a list to focus.
      if (
        direction === 'next' &&
        inputs.historyState.selectedIndex === null &&
        inputs.value.length === 0
      ) {
        inputs.onRequestFocusBackgroundList?.();
        return;
      }
      const result = navigatePromptHistory(
        inputs.value,
        inputs.promptHistory,
        inputs.historyState,
        direction,
      );
      inputs.setValue(result.value);
      inputs.setCursorHint(result.cursorHint);
      inputs.setHistoryState(result.state);
    },
    { isActive: !showPopup && !isDisabled && !pendingPrompt && !searchOpen },
  );

  // Backspace cancels queued prompt
  useKeybindingActions(
    'queued-prompt',
    (actions) => {
      if (actions.includes('cancel') && pendingPrompt) {
        inputs.onCancelQueue?.();
      }
    },
    { isActive: !!pendingPrompt && !isQueueCancellationDisabled },
  );
}
