export interface ITextPromptFlowState {
  value: string;
  error?: string;
  resolved: boolean;
}

export interface ITextPromptInputKey {
  escape?: boolean;
  return?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export type TTextPromptInputAction =
  | { type: 'cancel' }
  | { type: 'submit' }
  | { type: 'delete' }
  | { type: 'insert'; value: string };

export type TTextPromptEffect =
  | { type: 'none' }
  | { type: 'cancel' }
  | { type: 'submit'; value: string };

export interface ITextPromptFlowOptions {
  allowEmpty: boolean;
  validate?: (value: string) => string | undefined;
}

export function createTextPromptFlowState(): ITextPromptFlowState {
  return { value: '', resolved: false };
}

export function getTextPromptInputAction(
  input: string,
  key: ITextPromptInputKey,
): TTextPromptInputAction | undefined {
  if (key.escape === true) {
    return { type: 'cancel' };
  }
  if (key.return === true) {
    return { type: 'submit' };
  }
  if (key.backspace === true || key.delete === true) {
    return { type: 'delete' };
  }
  if (input && key.ctrl !== true && key.meta !== true) {
    return { type: 'insert', value: input };
  }
  return undefined;
}

export function applyTextPromptInput(
  state: ITextPromptFlowState,
  action: TTextPromptInputAction,
  options: ITextPromptFlowOptions,
): { state: ITextPromptFlowState; effect: TTextPromptEffect } {
  if (state.resolved) {
    return { state, effect: { type: 'none' } };
  }
  if (action.type === 'cancel') {
    return { state: { ...state, resolved: true }, effect: { type: 'cancel' } };
  }
  if (action.type === 'delete') {
    return {
      state: { ...state, value: state.value.slice(0, -1), error: undefined },
      effect: { type: 'none' },
    };
  }
  if (action.type === 'insert') {
    return {
      state: { ...state, value: state.value + action.value, error: undefined },
      effect: { type: 'none' },
    };
  }
  return submitTextPromptValue(state, options);
}

function submitTextPromptValue(
  state: ITextPromptFlowState,
  options: ITextPromptFlowOptions,
): { state: ITextPromptFlowState; effect: TTextPromptEffect } {
  const trimmed = state.value.trim();
  if (!trimmed && !options.allowEmpty) {
    const emptyError = options.validate?.(trimmed);
    return {
      state: emptyError ? { ...state, error: emptyError } : state,
      effect: { type: 'none' },
    };
  }
  const error = options.validate?.(trimmed);
  if (error !== undefined) {
    return { state: { ...state, error }, effect: { type: 'none' } };
  }
  return { state: { ...state, resolved: true }, effect: { type: 'submit', value: trimmed } };
}
