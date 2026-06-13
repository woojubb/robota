import {
  applySelectionInput,
  getDirectionalSelectionInputAction,
  type ISelectionFlowState,
  type ISelectionInputKey,
  type TSelectionInputAction,
} from './selection-flow.js';

export const PERMISSION_PROMPT_OPTIONS = [
  'Allow [y]',
  'Allow always (this session) [s]',
  'Allow always (this project) [p]',
  'Deny [n]',
] as const;

export type TPermissionPromptDecision = true | 'allow-session' | 'allow-project' | false;
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
  if (input === 's' || input === 'a' || input === '2') {
    return { type: 'shortcut', index: 1 };
  }
  if (input === 'p' || input === '3') {
    return { type: 'shortcut', index: 2 };
  }
  if (input === 'n' || input === 'd' || input === '4') {
    return { type: 'shortcut', index: 3 };
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

function getPermissionDecision(index: number): TPermissionPromptDecision {
  if (index === 0) return true;
  if (index === 1) return 'allow-session';
  if (index === 2) return 'allow-project';
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
