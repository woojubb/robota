/**
 * CLI-2004 — deletion, and what was deleted.
 *
 * A reader announces the line it is on. When a whole word or the whole line disappears, the only
 * thing it can say is what is LEFT — which is exactly the information you do not need. These helpers
 * return the removed text alongside the new value so the input can say what went.
 *
 * Word and line deletion are added here as well as reported: the flow had only single-character
 * backspace, so `Ctrl+W`/`Ctrl+U` previously fell through to the printable-input path.
 *
 * Extracted from `cjk-text-input-flow.ts` by responsibility — that module routes keystrokes, this
 * one computes edits.
 */

/** The result of one deletion: the new buffer, the new cursor, and the text that was removed. */
export interface ICjkDeletion {
  value: string;
  cursor: number;
  deleted: string;
}

/** Remove the character before the cursor. `undefined` at the start of the buffer. */
export function deleteCharBeforeCursor(value: string, cursor: number): ICjkDeletion | undefined {
  if (cursor <= 0) return undefined;
  return {
    value: value.slice(0, cursor - 1) + value.slice(cursor),
    cursor: cursor - 1,
    deleted: value.slice(cursor - 1, cursor),
  };
}

/**
 * Remove the word before the cursor — trailing spaces first, then the run of non-space characters,
 * which is the behaviour every shell's `Ctrl+W` has.
 */
export function deleteWordBeforeCursor(value: string, cursor: number): ICjkDeletion | undefined {
  if (cursor <= 0) return undefined;
  let start = cursor;
  while (start > 0 && /\s/u.test(value[start - 1] ?? '')) start -= 1;
  while (start > 0 && !/\s/u.test(value[start - 1] ?? '')) start -= 1;
  if (start === cursor) return undefined;
  return {
    value: value.slice(0, start) + value.slice(cursor),
    cursor: start,
    deleted: value.slice(start, cursor),
  };
}

/** Remove everything before the cursor (`Ctrl+U`). */
export function deleteLineBeforeCursor(value: string, cursor: number): ICjkDeletion | undefined {
  if (cursor <= 0) return undefined;
  return { value: value.slice(cursor), cursor: 0, deleted: value.slice(0, cursor) };
}
