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
 *
 * TEST BRANCH (test/cjk-cursor-positioning):
 * Using useBoxMetrics + useCursor to position the real terminal cursor
 * at the current cursor position via yoga node tree traversal for absolute coords.
 */

import fs from 'fs';

import chalk from 'chalk';
import { Box, Text, useInput, usePaste, useCursor, type DOMElement } from 'ink';
import React, { useRef, useState, useEffect } from 'react';
import stringWidth from 'string-width';

const DEBUG_LOG = '/tmp/cjk-cursor-debug.log';

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
  const boxRef = useRef<DOMElement | null>(null);
  const { setCursorPosition } = useCursor();

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

  // TEST: yoga tree traversal to compute absolute cursor position.
  // chalk.inverse cursor is DISABLED — real terminal cursor (via setCursorPosition) only.
  // Hypothesis: double cursor (chalk + terminal) causes IME composition artifacts ("녕안").
  useEffect(() => {
    if (!focus || !showCursor) {
      setCursorPosition(undefined);
      return;
    }
    if (boxRef.current == null) {
      return; // ref not attached yet — skip to avoid setting cursor to (0,0)
    }
    const abs = getAbsolutePosition(boxRef.current);
    const cursorX =
      abs.x + displayWidthBeforeCursor(stateRef.current.value, stateRef.current.cursor);

    // Debug: write computed coords to file (avoids corrupting TUI stdout/stderr).
    // Run: tail -f /tmp/cjk-cursor-debug.log  in a separate terminal to watch.
    fs.appendFileSync(
      // allow-fallback: debug-only, test branch
      DEBUG_LOG,
      `x=${cursorX}(abs.x=${abs.x}) y=${abs.y} cursor=${stateRef.current.cursor} val="${stateRef.current.value}"\n`,
    );

    setCursorPosition({ x: cursorX, y: abs.y });
  });

  return (
    <Box ref={boxRef}>
      <Text>
        {renderWithCursor(
          stateRef.current.value,
          stateRef.current.cursor,
          placeholder,
          false, // real terminal cursor handles this — chalk cursor disabled for IME test
        )}
      </Text>
    </Box>
  );
}

/** Walk the yoga parentNode chain to compute absolute position from the ink-root origin. */
function getAbsolutePosition(element: DOMElement | null): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let current: DOMElement | undefined | null = element;
  while (current != null) {
    const layout = current.yogaNode?.getComputedLayout();
    x += layout?.left ?? 0;
    y += layout?.top ?? 0;
    current = current.parentNode;
  }
  return { x, y };
}

/** Display column width of the text before the cursor index. */
function displayWidthBeforeCursor(value: string, cursor: number): number {
  const chars = [...value];
  let width = 0;
  for (let i = 0; i < cursor && i < chars.length; i++) {
    width += stringWidth(chars[i] ?? '');
  }
  return width;
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
