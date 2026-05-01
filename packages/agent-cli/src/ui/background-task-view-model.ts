import type {
  IBackgroundTaskState,
  TBackgroundTaskKind,
  TBackgroundTaskMode,
  TBackgroundTaskStatus,
  TBackgroundTaskTimeoutReason,
} from '@robota-sdk/agent-sdk';

const BACKGROUND_PREVIEW_LENGTH = 120;
const BACKGROUND_PREVIEW_WHITESPACE = /\s+/g;
const BACKGROUND_PREVIEW_SEPARATOR = ' ';
const SUCCESS_EXIT_CODE = 0;

export interface IBackgroundTaskViewModel {
  id: string;
  kind: TBackgroundTaskKind;
  label: string;
  status: TBackgroundTaskStatus;
  statusLabel: string;
  mode: TBackgroundTaskMode;
  currentAction?: string;
  unread: boolean;
  preview: string;
  resultPreview?: string;
  errorPreview?: string;
  startedAt?: string;
  lastActivityAt?: string;
  timeoutReason?: TBackgroundTaskTimeoutReason;
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
    statusLabel: getBackgroundTaskStatusLabel(state),
    mode: state.mode,
    currentAction: state.currentAction,
    unread: state.unread,
    preview: trimBackgroundPreview(state.promptPreview ?? state.commandPreview) ?? '',
    resultPreview: trimBackgroundPreview(state.result?.output ?? partialText),
    errorPreview: trimBackgroundPreview(state.error?.message),
    startedAt: state.startedAt,
    lastActivityAt: state.lastActivityAt,
    timeoutReason: state.timeoutReason,
  };
}

function getBackgroundTaskStatusLabel(state: IBackgroundTaskState): string {
  if (state.status === 'failed' && state.timeoutReason) {
    if (state.timeoutReason === 'idle' || state.timeoutReason === 'max_runtime') {
      return 'timed out';
    }
    return state.timeoutReason.replace(/_/g, ' ');
  }
  return state.status;
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
  const preview = value.trim().replace(BACKGROUND_PREVIEW_WHITESPACE, BACKGROUND_PREVIEW_SEPARATOR);
  if (!preview) return undefined;
  return preview.length > BACKGROUND_PREVIEW_LENGTH
    ? `${preview.slice(0, BACKGROUND_PREVIEW_LENGTH)}...`
    : preview;
}
