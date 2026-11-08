/**
 * SCREEN-014: pure reducer for keyboard navigation of the inline background-work list.
 *
 * Kept out of the App component so the navigation rules are exhaustively unit-testable without
 * rendering the whole TUI. The App's `useInput` translates the resulting action into focus/selection
 * state changes.
 */

/** A key event relevant to background-list navigation (subset of Ink's key object). */
export interface IBackgroundFocusKey {
  upArrow: boolean;
  downArrow: boolean;
  return: boolean;
  escape: boolean;
}

export type TBackgroundFocusAction =
  | { type: 'move'; index: number | null } // null = focus returns to the prompt input
  | { type: 'open'; index: number } // open the highlighted task's inline detail
  | { type: 'exit' } // leave the list, focus the prompt input
  | { type: 'none' }; // unhandled key — ignore

/**
 * Resolve a keypress while the background list holds focus.
 *
 * - ↑ moves up; ↑ past the first item returns focus to the input (`move` to `null`).
 * - ↓ moves down, clamped at the last item.
 * - Enter opens the highlighted task.
 * - Esc (or an emptied list) exits to the input.
 */
export function resolveBackgroundFocusKey(
  current: number,
  entryCount: number,
  key: IBackgroundFocusKey,
): TBackgroundFocusAction {
  if (entryCount <= 0) return { type: 'exit' };
  if (key.upArrow) return { type: 'move', index: current > 0 ? current - 1 : null };
  if (key.downArrow) {
    return { type: 'move', index: current < entryCount - 1 ? current + 1 : current };
  }
  if (key.return) return { type: 'open', index: Math.min(Math.max(current, 0), entryCount - 1) };
  if (key.escape) return { type: 'exit' };
  return { type: 'none' };
}
