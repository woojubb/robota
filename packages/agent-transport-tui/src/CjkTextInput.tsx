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

import chalk from 'chalk';
import { Text, useInput, usePaste } from 'ink';
import React, { useEffect, useRef, useState } from 'react';

import {
  applyCjkTextInput,
  applyCjkTextPaste,
  createCjkTextInputFlowState,
  syncCjkTextInputFlowState,
  type ICjkTextInputFlowState,
} from './flows/cjk-text-input-flow.js';
import {
  cancelDeferredSubmit,
  createDeferSubmitState,
  scheduleDeferredSubmit,
  type IDeferSubmitState,
} from './flows/defer-submit.js';

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
  /** CLI-061: deferred-submit state (timer + submit guard). The input pipeline stays live during the window. */
  deferState: IDeferSubmitState;
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
  // CLI-061: deferred-submit state so a trailing IME character (a stdin event arriving just after Enter) is
  // included in the submitted value. The timer is cancelled on unmount so no submit fires after teardown.
  const deferRef = useRef<IDeferSubmitState>(createDeferSubmitState());
  useEffect(() => () => cancelDeferredSubmit(deferRef.current), []);

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
    deferState: deferRef.current,
  });

  // Real terminal cursor positioning is intentionally omitted.
  // setCursorPosition(x, 0) crashes Terminal.app via Korean IME SIGSEGV.
  // Correct fix requires the input row's y offset from the bottom of the render,
  // which Ink does not expose. Tracked as a known limitation.

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
    applyCjkTextInputEffect(options, result.effect);
  } catch {
    // allow-fallback: Korean IME in raw mode can produce unexpected byte sequences
  }
}

function applyCjkTextInputEffect(
  options: IInputHandlerOptions,
  effect: ReturnType<typeof applyCjkTextInput>['effect'],
): void {
  if (effect.type === 'change') {
    options.onChange(effect.value);
  } else if (effect.type === 'submit') {
    // CLI-061: DEFER the submit and re-read the LIVE `stateRef.current.value` at fire time — never the stale
    // `effect.value` captured at Enter. The input pipeline (this same handler) stays live during the window, so
    // a trailing IME character's stdin event is applied to `stateRef` before the deferred read. The guard only
    // blocks a SECOND submit — it must not gate the input pipeline (that would drop the trailing char).
    const onSubmit = options.onSubmit;
    if (onSubmit) {
      scheduleDeferredSubmit(options.deferState, () => options.stateRef.current.value, onSubmit);
    }
  } else if (effect.type === 'paste') {
    options.onPaste?.(effect.text, effect.cursor);
  } else if (effect.type === 'render') {
    options.forceRender((n) => n + 1);
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
