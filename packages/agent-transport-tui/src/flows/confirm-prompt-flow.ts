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
