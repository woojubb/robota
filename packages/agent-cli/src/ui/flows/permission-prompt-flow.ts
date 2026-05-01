import {
  applySelectionInput,
  getDirectionalSelectionInputAction,
  type ISelectionFlowState,
  type ISelectionInputKey,
  type TSelectionInputAction,
} from './selection-flow.js';

export const PERMISSION_PROMPT_OPTIONS = ['Allow', 'Allow always (this session)', 'Deny'] as const;

export type TPermissionPromptDecision = true | 'allow-session' | false;
export type TPermissionPromptInputAction =
  | TSelectionInputAction
  | { type: 'shortcut'; index: number };

export type TPermissionPromptEffect =
  | { type: 'none' }
  | { type: 'resolve'; decision: TPermissionPromptDecision };

export function getPermissionPromptInputAction(
  input: string,
  key: ISelectionInputKey,
): TPermissionPromptInputAction | undefined {
  const action = getDirectionalSelectionInputAction({ ...key, escape: false });
  if (action !== undefined) {
    return action;
  }
  if (input === 'y' || input === '1') {
    return { type: 'shortcut', index: 0 };
  }
  if (input === 'a' || input === '2') {
    return { type: 'shortcut', index: 1 };
  }
  if (input === 'n' || input === 'd' || input === '3') {
    return { type: 'shortcut', index: 2 };
  }
  return undefined;
}

export function applyPermissionPromptInput(
  state: ISelectionFlowState,
  action: TPermissionPromptInputAction,
): { state: ISelectionFlowState; effect: TPermissionPromptEffect } {
  if (state.resolved) {
    return { state, effect: { type: 'none' } };
  }
  if (typeof action !== 'string') {
    return resolvePermissionIndex(state, action.index);
  }
  const result = applySelectionInput(state, action, {
    itemCount: PERMISSION_PROMPT_OPTIONS.length,
  });
  if (result.effect.type !== 'select') {
    return { state: result.state, effect: { type: 'none' } };
  }
  return {
    state: result.state,
    effect: { type: 'resolve', decision: getPermissionDecision(result.effect.index) },
  };
}

export function getPermissionDecision(index: number): TPermissionPromptDecision {
  if (index === 0) return true;
  if (index === 1) return 'allow-session';
  return false;
}

function resolvePermissionIndex(
  state: ISelectionFlowState,
  index: number,
): { state: ISelectionFlowState; effect: TPermissionPromptEffect } {
  return {
    state: { ...state, selectedIndex: index, resolved: true },
    effect: { type: 'resolve', decision: getPermissionDecision(index) },
  };
}
