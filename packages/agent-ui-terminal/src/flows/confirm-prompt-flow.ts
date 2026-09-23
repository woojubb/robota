import {
  applySelectionInput,
  getDirectionalSelectionInputAction,
  type ISelectionFlowState,
  type ISelectionInputKey,
  type TSelectionEffect,
  type TSelectionInputAction,
} from './selection-flow.js';

export type TConfirmPromptInputAction = TSelectionInputAction | { type: 'shortcut'; index: number };

export function getConfirmPromptInputAction(
  input: string,
  key: ISelectionInputKey,
  optionCount: number,
): TConfirmPromptInputAction | undefined {
  const action = getDirectionalSelectionInputAction({ ...key, escape: false });
  if (action !== undefined) {
    return action;
  }
  if (optionCount === 2 && input === 'y') {
    return { type: 'shortcut', index: 0 };
  }
  if (optionCount === 2 && input === 'n') {
    return { type: 'shortcut', index: 1 };
  }
  return undefined;
}

/**
 * CLI-2004 — the typed yes/no answer.
 *
 * A two-option arrow menu is the worst shape for a reader: both rows are announced, and which one is
 * selected differs only by a cursor glyph and a colour. In screen-reader mode the prompt asks for a
 * typed answer instead — `y`, `n`, `yes` or `no`, then Enter. Anything else clears the buffer and
 * resolves nothing, so a mistyped answer cannot be read as consent.
 */
export interface ITypedConfirmState {
  buffer: string;
  resolved: boolean;
}

export function createTypedConfirmState(): ITypedConfirmState {
  return { buffer: '', resolved: false };
}

const YES_ANSWERS = ['y', 'yes'];
const NO_ANSWERS = ['n', 'no'];

export function applyTypedConfirmInput(
  state: ITypedConfirmState,
  input: string,
  key: ISelectionInputKey & { backspace?: boolean; delete?: boolean },
): { state: ITypedConfirmState; effect: TSelectionEffect } {
  if (state.resolved) return { state, effect: { type: 'none' } };
  if (key.backspace === true || key.delete === true) {
    return { state: { ...state, buffer: state.buffer.slice(0, -1) }, effect: { type: 'none' } };
  }
  if (key.return === true) {
    const answer = state.buffer.trim().toLowerCase();
    if (YES_ANSWERS.includes(answer)) {
      return { state: { buffer: '', resolved: true }, effect: { type: 'select', index: 0 } };
    }
    if (NO_ANSWERS.includes(answer)) {
      return { state: { buffer: '', resolved: true }, effect: { type: 'select', index: 1 } };
    }
    return { state: { ...state, buffer: '' }, effect: { type: 'none' } };
  }
  if (/^[a-zA-Z]+$/.test(input)) {
    return { state: { ...state, buffer: state.buffer + input }, effect: { type: 'none' } };
  }
  return { state, effect: { type: 'none' } };
}

export function applyConfirmPromptInput(
  state: ISelectionFlowState,
  action: TConfirmPromptInputAction,
  optionCount: number,
): { state: ISelectionFlowState; effect: TSelectionEffect } {
  if (state.resolved) {
    return { state, effect: { type: 'none' } };
  }
  if (typeof action !== 'string') {
    return {
      state: { ...state, selectedIndex: action.index, resolved: true },
      effect: { type: 'select', index: action.index },
    };
  }
  return applySelectionInput(state, action, { itemCount: optionCount });
}
