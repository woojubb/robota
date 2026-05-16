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
import { Text, useInput, usePaste } from 'ink';
import chalk from 'chalk';
import {
  applyCjkTextInput,
  applyCjkTextPaste,
  createCjkTextInputFlowState,
  syncCjkTextInputFlowState,
  type ICjkTextInputFlowState,
} from './flows/cjk-text-input-flow.js';

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
  /** When false, parent flows own up/down arrow behavior. */
  enableVerticalNavigation?: boolean;
}

interface IInputHandlerOptions {
  stateRef: React.MutableRefObject<ICjkTextInputFlowState>;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  onPaste?: (text: string, cursorPosition: number) => void;
  availableWidth?: number;
  focus: boolean;
  enableVerticalNavigation: boolean;
  forceRender: React.Dispatch<React.SetStateAction<number>>;
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
  enableVerticalNavigation = true,
}: IProps): React.ReactElement {
  const stateRef = useRef<ICjkTextInputFlowState>(createCjkTextInputFlowState(value));
  const [, forceRender] = useState(0);

  // useCursor removed — see comment below about Terminal.app SIGSEGV

  // Sync ref when value changes from parent (e.g., setValue(''), tab completion, paste)
  stateRef.current = syncCjkTextInputFlowState(stateRef.current, value, cursorHint);

  useCjkTextInputHandlers({
    stateRef,
    onChange,
    onSubmit,
    onPaste,
    availableWidth,
    focus,
    enableVerticalNavigation,
    forceRender,
  });

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
      {renderWithCursor(
        stateRef.current.value,
        stateRef.current.cursor,
        placeholder,
        showCursor && focus,
      )}
    </Text>
  );
}

function useCjkTextInputHandlers(options: IInputHandlerOptions): void {
  usePaste(
    (text) => {
      applyCjkFlowSafely(options, () =>
        applyCjkTextPaste(options.stateRef.current, text, createFlowOptions(options)),
      );
    },
    { isActive: options.focus },
  );

  useInput(
    (input, key) => {
      applyCjkFlowSafely(options, () =>
        applyCjkTextInput(options.stateRef.current, input, key, createFlowOptions(options)),
      );
    },
    { isActive: options.focus },
  );
}

function createFlowOptions(options: IInputHandlerOptions): {
  availableWidth?: number;
  canPaste: boolean;
  enableVerticalNavigation: boolean;
} {
  return {
    availableWidth: options.availableWidth,
    canPaste: options.onPaste !== undefined,
    enableVerticalNavigation: options.enableVerticalNavigation,
  };
}

function applyCjkFlowSafely(
  options: IInputHandlerOptions,
  run: () => ReturnType<typeof applyCjkTextInput>,
): void {
  try {
    const result = run();
    options.stateRef.current = result.state;
    applyCjkTextInputEffect(
      result.effect,
      options.onChange,
      options.onSubmit,
      options.onPaste,
      options.forceRender,
    );
  } catch {
    // Korean IME in raw mode can produce unexpected byte sequences.
  }
}

function applyCjkTextInputEffect(
  effect: ReturnType<typeof applyCjkTextInput>['effect'],
  onChange: (value: string) => void,
  onSubmit: ((value: string) => void) | undefined,
  onPaste: ((text: string, cursorPosition: number) => void) | undefined,
  forceRender: React.Dispatch<React.SetStateAction<number>>,
): void {
  if (effect.type === 'change') {
    onChange(effect.value);
  } else if (effect.type === 'submit') {
    onSubmit?.(effect.value);
  } else if (effect.type === 'paste') {
    onPaste?.(effect.text, effect.cursor);
  } else if (effect.type === 'render') {
    forceRender((n) => n + 1);
  }
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
