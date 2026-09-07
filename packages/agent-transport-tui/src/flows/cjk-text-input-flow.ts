import stringWidth from 'string-width';

import { moveCursorHorizontally, moveCursorVertically } from './cjk-cursor-motion.js';
import {
  deleteCharBeforeCursor,
  deleteLineBeforeCursor,
  deleteWordBeforeCursor,
  type ICjkDeletion,
} from './cjk-text-deletion.js';

const PASTE_START = '[200~';
const PASTE_END = '[201~';
const LAST_ASCII_CONTROL_CODE = 0x1f;
const DELETE_CONTROL_CODE = 0x7f;

export { charIndexAtDisplayOffset, displayOffset } from './cjk-cursor-motion.js';

export interface ICjkTextInputFlowState {
  value: string;
  cursor: number;
  isPasting: boolean;
  pasteBuffer: string;
}

export interface ICjkTextInputKey {
  ctrl?: boolean;
  tab?: boolean;
  shift?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  return?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  backspace?: boolean;
  delete?: boolean;
}

export interface ICjkTextInputFlowOptions {
  availableWidth?: number;
  canPaste: boolean;
  enableVerticalNavigation?: boolean;
}

/** CLI-2004: a word/line delete is announced; a single-character backspace is not (it is heard). */
export type TCjkDeletionScope = 'word' | 'line';

export type TCjkTextInputEffect =
  | { type: 'none' }
  | { type: 'change'; value: string; deleted?: string; deletedScope?: TCjkDeletionScope }
  | { type: 'submit'; value: string }
  | { type: 'paste'; text: string; cursor: number }
  | { type: 'render' };

interface ICjkTextInputFlowResult {
  state: ICjkTextInputFlowState;
  effect: TCjkTextInputEffect;
}

export function createCjkTextInputFlowState(value: string): ICjkTextInputFlowState {
  return { value, cursor: value.length, isPasting: false, pasteBuffer: '' };
}

export function syncCjkTextInputFlowState(
  state: ICjkTextInputFlowState,
  value: string,
  cursorHint: number | null,
): ICjkTextInputFlowState {
  if (value === state.value) {
    return state;
  }
  return {
    ...state,
    value,
    cursor: cursorHint != null ? Math.min(cursorHint, value.length) : value.length,
  };
}

export function applyCjkTextInput(
  state: ICjkTextInputFlowState,
  input: string,
  key: ICjkTextInputKey,
  options: ICjkTextInputFlowOptions,
): ICjkTextInputFlowResult {
  const pasteResult = applyPasteBoundaryInput(state, input, options);
  if (pasteResult !== undefined) return pasteResult;
  const controlResult = applyControlInput(state, input, key, options);
  if (controlResult !== undefined) return controlResult;
  const cursorResult = applyCursorInput(state, key, options);
  if (cursorResult !== undefined) return cursorResult;
  return insertPrintableInput(state, input);
}

export function applyCjkTextPaste(
  state: ICjkTextInputFlowState,
  text: string,
  options: ICjkTextInputFlowOptions,
): ICjkTextInputFlowResult {
  const normalizedText = text.replace(/\r\n?/g, '\n');
  if (normalizedText.length === 0) {
    return { state, effect: { type: 'none' } };
  }
  if (normalizedText.includes('\n') && options.canPaste) {
    return { state, effect: { type: 'paste', text: normalizedText, cursor: state.cursor } };
  }
  return insertPrintableInput(state, normalizedText);
}

function applyPasteBoundaryInput(
  state: ICjkTextInputFlowState,
  input: string,
  options: ICjkTextInputFlowOptions,
): ICjkTextInputFlowResult | undefined {
  if (input === PASTE_START || input.startsWith(PASTE_START)) {
    return startBracketedPaste(state, input);
  }
  if (state.isPasting) {
    return continueBracketedPaste(state, input, options);
  }
  return undefined;
}

function applyControlInput(
  state: ICjkTextInputFlowState,
  input: string,
  key: ICjkTextInputKey,
  options: ICjkTextInputFlowOptions,
): ICjkTextInputFlowResult | undefined {
  if ((key.ctrl === true && input === 'c') || key.tab === true) {
    return { state, effect: { type: 'none' } };
  }
  if (key.ctrl === true && (input === 'w' || input === 'u')) {
    const scope: TCjkDeletionScope = input === 'w' ? 'word' : 'line';
    const remove = scope === 'word' ? deleteWordBeforeCursor : deleteLineBeforeCursor;
    return applyDeletion(state, remove(state.value, state.cursor), scope);
  }
  if (key.return === true) {
    return { state, effect: { type: 'submit', value: state.value } };
  }
  if (input.length > 1 && (input.includes('\n') || input.includes('\r')) && options.canPaste) {
    return {
      state,
      effect: { type: 'paste', text: input.replace(/\r\n?/g, '\n'), cursor: state.cursor },
    };
  }
  return undefined;
}

function applyCursorInput(
  state: ICjkTextInputFlowState,
  key: ICjkTextInputKey,
  options: ICjkTextInputFlowOptions,
): ICjkTextInputFlowResult | undefined {
  if (key.upArrow === true || key.downArrow === true) {
    if (options.enableVerticalNavigation === false) {
      return { state, effect: { type: 'none' } };
    }
    return moveCursorVertically(
      state,
      key.upArrow === true ? 'up' : 'down',
      options.availableWidth,
    );
  }
  if (key.leftArrow === true) {
    return moveCursorHorizontally(state, 'left');
  }
  if (key.rightArrow === true) {
    return moveCursorHorizontally(state, 'right');
  }
  if (key.backspace === true || key.delete === true) {
    return applyDeletion(state, deleteCharBeforeCursor(state.value, state.cursor));
  }
  return undefined;
}

export function filterPrintable(input: string | null | undefined): string {
  if (!input || input.length === 0) return '';
  let output = '';
  for (const char of input) {
    const code = char.charCodeAt(0);
    if (code > LAST_ASCII_CONTROL_CODE && code !== DELETE_CONTROL_CODE) {
      output += char;
    }
  }
  return output;
}

export function insertAtCursor(
  value: string,
  cursor: number,
  input: string,
): { value: string; cursor: number } {
  const next = value.slice(0, cursor) + input + value.slice(cursor);
  return { value: next, cursor: cursor + input.length };
}

function startBracketedPaste(
  state: ICjkTextInputFlowState,
  input: string,
): ICjkTextInputFlowResult {
  return {
    state: { ...state, isPasting: true, pasteBuffer: input.slice(PASTE_START.length) },
    effect: { type: 'none' },
  };
}

function continueBracketedPaste(
  state: ICjkTextInputFlowState,
  input: string,
  options: ICjkTextInputFlowOptions,
): ICjkTextInputFlowResult {
  if (input !== PASTE_END && !input.includes(PASTE_END)) {
    return {
      state: { ...state, pasteBuffer: state.pasteBuffer + input },
      effect: { type: 'none' },
    };
  }
  const beforeMarker = input.split(PASTE_END)[0] ?? '';
  const nextState = { ...state, isPasting: false, pasteBuffer: '' };
  return applyCjkTextPaste(nextState, state.pasteBuffer + beforeMarker, options);
}

/**
 * Apply a deletion result. A word/line delete carries the removed text so the caller can announce
 * it; a character delete does not — the reader already heard the character go.
 */
function applyDeletion(
  state: ICjkTextInputFlowState,
  deletion: ICjkDeletion | undefined,
  scope?: TCjkDeletionScope,
): ICjkTextInputFlowResult {
  if (deletion === undefined) {
    return { state, effect: { type: 'none' } };
  }
  return {
    state: { ...state, value: deletion.value, cursor: deletion.cursor },
    effect: {
      type: 'change',
      value: deletion.value,
      ...(scope !== undefined ? { deleted: deletion.deleted, deletedScope: scope } : {}),
    },
  };
}

function insertPrintableInput(
  state: ICjkTextInputFlowState,
  input: string,
): ICjkTextInputFlowResult {
  const printable = filterPrintable(input);
  if (printable.length === 0) {
    return { state, effect: { type: 'none' } };
  }
  const result = insertAtCursor(state.value, state.cursor, printable);
  return {
    state: { ...state, value: result.value, cursor: result.cursor },
    effect: { type: 'change', value: result.value },
  };
}
