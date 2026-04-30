import type {
  IBackgroundTaskState,
  TBackgroundTaskKind,
  TBackgroundTaskMode,
  TBackgroundTaskStatus,
} from '@robota-sdk/agent-sdk';

const BACKGROUND_PREVIEW_LENGTH = 120;
const SUCCESS_EXIT_CODE = 0;

export interface IBackgroundTaskViewModel {
  id: string;
  kind: TBackgroundTaskKind;
  label: string;
  status: TBackgroundTaskStatus;
  mode: TBackgroundTaskMode;
  currentAction?: string;
  unread: boolean;
  preview: string;
  resultPreview?: string;
  errorPreview?: string;
}

export function toBackgroundTaskViewModel(
  state: IBackgroundTaskState,
  partialText?: string,
): IBackgroundTaskViewModel {
  return {
    id: state.id,
    kind: state.kind,
    label: state.label,
    status: state.status,
    mode: state.mode,
    currentAction: state.currentAction,
    unread: state.unread,
    preview: trimBackgroundPreview(state.promptPreview ?? state.commandPreview) ?? '',
    resultPreview: trimBackgroundPreview(state.result?.output ?? partialText),
    errorPreview: trimBackgroundPreview(state.error?.message),
  };
}

export function shouldHideAtNextUserTurn(state: IBackgroundTaskState): boolean {
  return (
    state.status === 'completed' &&
    !state.error &&
    (state.result?.exitCode === undefined || state.result.exitCode === SUCCESS_EXIT_CODE) &&
    !state.result?.signalCode &&
    !state.worktreePath &&
    !state.branchName
  );
}

export function trimBackgroundPreview(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length > BACKGROUND_PREVIEW_LENGTH
    ? `${value.slice(0, BACKGROUND_PREVIEW_LENGTH)}...`
    : value;
}
