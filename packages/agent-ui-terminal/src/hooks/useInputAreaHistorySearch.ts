/**
 * SCREEN-1993 — the input area's side of prompt-history search: the `chat-input.history-search`
 * open binding, and what insert and execute do to the composer.
 *
 * Insert replaces the composer text with the match (cursor at the end); execute submits the match
 * through the same path Enter takes, so it is recorded in the live prompt list like any prompt. While
 * the overlay is open the composer is untouched, which is what makes cancel restore the draft exactly.
 */
import { useCallback, useEffect } from 'react';

import {
  useHistorySearch,
  type IHistorySearchSurface,
} from '../history-search/useHistorySearch.js';
import { useKeybindingActions } from '../keybindings/keybindings-context.js';

import type { IHistorySearchView } from '../history-search/useHistorySearch.js';

/** What the input area receives from the app; absent ⇒ the feature is off and `ctrl+r` is inert. */
export interface IInputAreaHistorySearch extends IHistorySearchSurface {
  /** Lets the app block its own bindings (Esc abort, the switcher) while the overlay is open. */
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
}

export interface IUseInputAreaHistorySearchOptions {
  readonly historySearch: IInputAreaHistorySearch | undefined;
  readonly sessionPrompts: readonly string[];
  /** The composer can take keys: no popup, not disabled, nothing queued. */
  readonly composerActive: boolean;
  readonly setValue: (value: string) => void;
  readonly setCursorHint: (hint: number | null) => void;
  readonly submitPrompt: (prompt: string) => void;
}

export function useInputAreaHistorySearch(
  options: IUseInputAreaHistorySearchOptions,
): IHistorySearchView {
  const { historySearch, setValue, setCursorHint, submitPrompt, composerActive } = options;
  const onInsert = useCallback(
    (text: string) => {
      setValue(text);
      setCursorHint(null);
    },
    [setCursorHint, setValue],
  );
  const onExecute = useCallback(
    (text: string) => {
      setValue('');
      submitPrompt(text);
    },
    [setValue, submitPrompt],
  );
  const { view, openSearch, closeSearch } = useHistorySearch({
    surface: historySearch,
    sessionPrompts: options.sessionPrompts,
    onInsert,
    onExecute,
    onOpenChange: historySearch?.onOpenChange,
  });
  useKeybindingActions(
    'chat-input',
    (actions) => {
      if (actions.includes('history-search')) openSearch();
    },
    { isActive: composerActive && !view.open && historySearch !== undefined },
  );
  // Another overlay or a disabled composer takes the keys: the search cannot stay open under it.
  useEffect(() => {
    if (view.open && !composerActive) closeSearch();
  }, [closeSearch, composerActive, view.open]);
  return view;
}
