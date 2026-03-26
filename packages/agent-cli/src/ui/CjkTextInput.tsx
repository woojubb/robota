/**
 * CJK-aware TextInput component for Ink.
 *
 * Replaces ink-text-input with proper wide character support:
 * - Uses string-width for display width calculation
 * - Cursor position based on character index (not display columns)
 * - Renders CJK characters correctly (2 columns each)
 * - Uses refs for value/cursor to avoid React state batching issues
 *   (IME sends multiple keystrokes synchronously, state updates are async)
 *
 * Drop-in replacement: same props as ink-text-input.
 */

import React, { useRef, useState } from 'react';
import { Text, useInput } from 'ink';
import chalk from 'chalk';
import stringWidth from 'string-width';

/** Bracketed paste mode markers as delivered by Ink's input parser.
 *  Ink's CSI parser consumes the ESC (\x1b) prefix, so useInput
 *  receives only the remainder: "[200~" and "[201~". */
const PASTE_START = '[200~';
const PASTE_END = '[201~';

/**
 * Filter non-printable characters from input. Returns empty string if
 * input is null/undefined/empty or contains only control characters.
 * Exported for testing.
 */
export function filterPrintable(input: string | null | undefined): string {
  if (!input || input.length === 0) return '';
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\x00-\x1f\x7f]/g, '');
}

/**
 * Insert text into a value at the given cursor position.
 * Returns { value, cursor } with updated state.
 * Exported for testing.
 */
export function insertAtCursor(
  value: string,
  cursor: number,
  input: string,
): { value: string; cursor: number } {
  const next = value.slice(0, cursor) + input + value.slice(cursor);
  return { value: next, cursor: cursor + input.length };
}

/** Cumulative display offset of cursor, accounting for CJK line-end gaps. Exported for testing. */
export function displayOffset(chars: string[], charIndex: number, width: number): number {
  let offset = 0;
  for (let i = 0; i < charIndex && i < chars.length; i++) {
    const w = stringWidth(chars[i]!);
    const col = offset % width;
    if (col + w > width) offset += width - col;
    offset += w;
  }
  return offset;
}

/** Find char index closest to a target display offset. Exported for testing. */
export function charIndexAtDisplayOffset(chars: string[], target: number, width: number): number {
  let offset = 0;
  for (let i = 0; i < chars.length; i++) {
    if (offset >= target) return i;
    const w = stringWidth(chars[i]!);
    const col = offset % width;
    if (col + w > width) offset += width - col;
    offset += w;
  }
  return chars.length;
}

interface IProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  onPaste?: (text: string, cursorPosition: number) => void;
  placeholder?: string;
  focus?: boolean;
  showCursor?: boolean;
  /** Available width in columns for visual line wrapping navigation */
  availableWidth?: number;
  /** Cursor position hint for external value changes. null = end (default). */
  cursorHint?: number | null;
}

export default function CjkTextInput({
  value,
  onChange,
  onSubmit,
  onPaste,
  placeholder = '',
  focus = true,
  showCursor = true,
  availableWidth,
  cursorHint = null,
}: IProps): React.ReactElement {
  // Use refs for value and cursor to avoid React batching issues.
  // When IME sends "다" + "." in rapid succession, setState is async
  // and the second keystroke reads stale state. Refs are synchronous.
  const valueRef = useRef(value);
  const cursorRef = useRef(value.length);
  const [, forceRender] = useState(0);

  // Bracketed paste mode: terminal sends \x1b[200~ before paste and
  // \x1b[201~ after. We buffer all input between these markers.
  const isPastingRef = useRef(false);
  const pasteBufferRef = useRef('');

  // useCursor removed — see comment below about Terminal.app SIGSEGV

  // Sync ref when value changes from parent (e.g., setValue(''), tab completion, paste)
  if (value !== valueRef.current) {
    valueRef.current = value;
    // cursorHint: number = move to that position, null = move to end
    cursorRef.current = cursorHint != null ? Math.min(cursorHint, value.length) : value.length;
  }

  useInput(
    (input, key) => {
      try {
        // Bracketed paste mode: detect start/end markers
        if (input === PASTE_START || input.startsWith(PASTE_START)) {
          isPastingRef.current = true;
          const afterMarker = input.slice(PASTE_START.length);
          if (afterMarker.length > 0) {
            pasteBufferRef.current += afterMarker;
          }
          return;
        }

        if (isPastingRef.current) {
          if (input === PASTE_END || input.includes(PASTE_END)) {
            const beforeMarker = input.split(PASTE_END)[0] ?? '';
            pasteBufferRef.current += beforeMarker;
            const text = pasteBufferRef.current.replace(/\r\n?/g, '\n');
            pasteBufferRef.current = '';
            isPastingRef.current = false;
            if (text.length > 0) {
              // Multiline paste → label replacement via onPaste
              // Single-line paste → insert directly as typed text
              if (text.includes('\n') && onPaste) {
                onPaste(text, cursorRef.current);
              } else {
                const printable = filterPrintable(text);
                if (printable.length > 0) {
                  const result = insertAtCursor(valueRef.current, cursorRef.current, printable);
                  cursorRef.current = result.cursor;
                  valueRef.current = result.value;
                  onChange(result.value);
                }
              }
            }
          } else {
            pasteBufferRef.current += input;
          }
          return;
        }

        if ((key.ctrl && input === 'c') || key.tab || (key.shift && key.tab)) {
          return;
        }

        if (key.upArrow || key.downArrow) {
          if (availableWidth && availableWidth > 0) {
            const chars = [...valueRef.current];
            const offset = displayOffset(chars, cursorRef.current, availableWidth);
            const target = key.upArrow ? offset - availableWidth : offset + availableWidth;
            if (target >= 0) {
              const newCursor = charIndexAtDisplayOffset(chars, target, availableWidth);
              if (newCursor !== cursorRef.current) {
                cursorRef.current = newCursor;
                forceRender((n) => n + 1);
              }
            }
          }
          return;
        }

        if (key.return) {
          onSubmit?.(valueRef.current);
          return;
        }

        // Fallback for terminals without bracketed paste mode:
        // multi-char input with newlines is likely a paste
        if (input.length > 1 && (input.includes('\n') || input.includes('\r')) && onPaste) {
          onPaste(input.replace(/\r\n?/g, '\n'), cursorRef.current);
          return;
        }

        if (key.leftArrow) {
          if (cursorRef.current > 0) {
            cursorRef.current -= 1;
            forceRender((n) => n + 1);
          }
          return;
        }

        if (key.rightArrow) {
          if (cursorRef.current < valueRef.current.length) {
            cursorRef.current += 1;
            forceRender((n) => n + 1);
          }
          return;
        }

        if (key.backspace || key.delete) {
          if (cursorRef.current > 0) {
            const v = valueRef.current;
            const next = v.slice(0, cursorRef.current - 1) + v.slice(cursorRef.current);
            cursorRef.current -= 1;
            valueRef.current = next;
            onChange(next);
          }
          return;
        }

        // Guard against IME sending empty or control characters
        const printable = filterPrintable(input);
        if (printable.length === 0) return;

        // Regular character input — update ref synchronously
        const result = insertAtCursor(valueRef.current, cursorRef.current, printable);
        cursorRef.current = result.cursor;
        valueRef.current = result.value;
        onChange(result.value);
      } catch {
        // Swallow IME-related errors to prevent terminal crash.
        // Korean IME in raw mode can produce unexpected byte sequences.
      }
    },
    { isActive: focus },
  );

  // Do NOT call setCursorPosition() — passing y:0 moves the real terminal cursor
  // to the top of the entire ink output (logo area), which causes Terminal.app to
  // SIGSEGV when Korean IME queries attributedSubstringFromRange: at that position.
  // Without setCursorPosition, the IME candidate window appears at bottom-left
  // (same behavior as Claude Code, issue #19207), but Terminal.app does not crash.
  //
  // A correct fix would require knowing the total rendered height to pass the right
  // y coordinate, which ink does not expose to components.

  return (
    <Text>
      {renderWithCursor(valueRef.current, cursorRef.current, placeholder, showCursor && focus)}
    </Text>
  );
}

/** Render text with an inverse-style cursor at the correct position */
function renderWithCursor(
  value: string,
  cursorOffset: number,
  placeholder: string,
  showCursor: boolean,
): string {
  if (!showCursor) {
    return value.length > 0 ? value : placeholder ? chalk.gray(placeholder) : '';
  }

  if (value.length === 0) {
    if (placeholder.length > 0) {
      return chalk.inverse(placeholder[0]) + chalk.gray(placeholder.slice(1));
    }
    return chalk.inverse(' ');
  }

  const chars = [...value];
  let rendered = '';

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i] ?? '';
    rendered += i === cursorOffset ? chalk.inverse(char) : char;
  }

  if (cursorOffset >= chars.length) {
    rendered += chalk.inverse(' ');
  }

  return rendered;
}
