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
import { Text, useInput, useCursor } from 'ink';
import stringWidth from 'string-width';
import chalk from 'chalk';

interface IProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
  showCursor?: boolean;
}

export default function CjkTextInput({
  value,
  onChange,
  onSubmit,
  placeholder = '',
  focus = true,
  showCursor = true,
}: IProps): React.ReactElement {
  // Use refs for value and cursor to avoid React batching issues.
  // When IME sends "다" + "." in rapid succession, setState is async
  // and the second keystroke reads stale state. Refs are synchronous.
  const valueRef = useRef(value);
  const cursorRef = useRef(value.length);
  const [, forceRender] = useState(0);

  // Provide cursor position to Ink for IME candidate window placement.
  // This prevents Terminal.app SIGSEGV when Korean IME queries attributedSubstringFromRange:
  // without a valid cursor position, Terminal.app dereferences null → crash.
  const { setCursorPosition } = useCursor();

  // Sync ref when value changes from parent (e.g., setValue(''))
  if (value !== valueRef.current) {
    valueRef.current = value;
    if (cursorRef.current > value.length) {
      cursorRef.current = value.length;
    }
  }

  useInput(
    (input, key) => {
      if (
        key.upArrow ||
        key.downArrow ||
        (key.ctrl && input === 'c') ||
        key.tab ||
        (key.shift && key.tab)
      ) {
        return;
      }

      if (key.return) {
        onSubmit?.(valueRef.current);
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

      // Regular character input — update ref synchronously
      const v = valueRef.current;
      const c = cursorRef.current;
      const next = v.slice(0, c) + input + v.slice(c);
      cursorRef.current = c + input.length;
      valueRef.current = next;
      onChange(next);
    },
    { isActive: focus },
  );

  // Calculate display-width cursor position for IME.
  // x offset accounts for prompt prefix ("│ > ") in InputArea — border(1) + padding(1) + "> "(2) = 4 cols.
  if (showCursor && focus) {
    const textBeforeCursor = [...valueRef.current].slice(0, cursorRef.current).join('');
    const cursorX = 4 + stringWidth(textBeforeCursor);
    setCursorPosition({ x: cursorX, y: 0 });
  }

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
