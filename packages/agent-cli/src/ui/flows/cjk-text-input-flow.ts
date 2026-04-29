import stringWidth from 'string-width';

const PASTE_START = '[200~';
const PASTE_END = '[201~';
const LAST_ASCII_CONTROL_CODE = 0x1f;
const DELETE_CONTROL_CODE = 0x7f;

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
}

export type TCjkTextInputEffect =
  | { type: 'none' }
  | { type: 'change'; value: string }
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
  const cursorResult = applyCursorInput(state, key, options.availableWidth);
  if (cursorResult !== undefined) return cursorResult;
  return insertPrintableInput(state, input);
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
  availableWidth: number | undefined,
): ICjkTextInputFlowResult | undefined {
  if (key.upArrow === true || key.downArrow === true) {
    return moveCursorVertically(state, key.upArrow === true ? 'up' : 'down', availableWidth);
  }
  if (key.leftArrow === true) {
    return moveCursorHorizontally(state, 'left');
  }
  if (key.rightArrow === true) {
    return moveCursorHorizontally(state, 'right');
  }
  if (key.backspace === true || key.delete === true) {
    return deleteBeforeCursor(state);
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
  const text = (state.pasteBuffer + beforeMarker).replace(/\r\n?/g, '\n');
  const nextState = { ...state, isPasting: false, pasteBuffer: '' };
  if (text.length === 0) {
    return { state: nextState, effect: { type: 'none' } };
  }
  if (text.includes('\n') && options.canPaste) {
    return { state: nextState, effect: { type: 'paste', text, cursor: state.cursor } };
  }
  return insertPrintableInput(nextState, text);
}

function moveCursorVertically(
  state: ICjkTextInputFlowState,
  direction: 'up' | 'down',
  availableWidth: number | undefined,
): ICjkTextInputFlowResult {
  if (!availableWidth || availableWidth <= 0) {
    return { state, effect: { type: 'none' } };
  }
  const chars = [...state.value];
  const offset = displayOffset(chars, state.cursor, availableWidth);
  const target = direction === 'up' ? offset - availableWidth : offset + availableWidth;
  if (target < 0) {
    return { state, effect: { type: 'none' } };
  }
  const cursor = charIndexAtDisplayOffset(chars, target, availableWidth);
  if (cursor === state.cursor) {
    return { state, effect: { type: 'none' } };
  }
  return { state: { ...state, cursor }, effect: { type: 'render' } };
}

function moveCursorHorizontally(
  state: ICjkTextInputFlowState,
  direction: 'left' | 'right',
): ICjkTextInputFlowResult {
  if (direction === 'left' && state.cursor > 0) {
    return { state: { ...state, cursor: state.cursor - 1 }, effect: { type: 'render' } };
  }
  if (direction === 'right' && state.cursor < state.value.length) {
    return { state: { ...state, cursor: state.cursor + 1 }, effect: { type: 'render' } };
  }
  return { state, effect: { type: 'none' } };
}

function deleteBeforeCursor(state: ICjkTextInputFlowState): ICjkTextInputFlowResult {
  if (state.cursor === 0) {
    return { state, effect: { type: 'none' } };
  }
  const value = state.value.slice(0, state.cursor - 1) + state.value.slice(state.cursor);
  return {
    state: { ...state, value, cursor: state.cursor - 1 },
    effect: { type: 'change', value },
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
