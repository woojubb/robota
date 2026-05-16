export type TStatusActivityKind = 'tools' | 'thinking' | 'background' | 'queued' | 'idle';

export interface IStatusActivityInput {
  isThinking: boolean;
  activeToolCount: number;
  activeBackgroundTaskCount: number;
  hasPendingPrompt: boolean;
}

export interface IStatusActivity {
  kind: TStatusActivityKind;
  label: string;
  color: string;
  segments: string[];
  text: string;
}

const NO_ACTIVE_ITEMS = 0;

export function formatStatusActivity(input: IStatusActivityInput): IStatusActivity {
  const base = getPrimaryActivity(input);
  const segments = input.hasPendingPrompt && base.kind !== 'queued' ? ['queued'] : [];
  const text = [base.label, ...segments].join(' · ');
  return { ...base, segments, text };
}

function getPrimaryActivity(
  input: IStatusActivityInput,
): Omit<IStatusActivity, 'segments' | 'text'> {
  if (input.activeToolCount > NO_ACTIVE_ITEMS) {
    return {
      kind: 'tools',
      label: `Tools x${input.activeToolCount}`,
      color: 'cyan',
    };
  }
  if (input.isThinking) {
    return {
      kind: 'thinking',
      label: 'Thinking',
      color: 'yellow',
    };
  }
  if (input.activeBackgroundTaskCount > NO_ACTIVE_ITEMS) {
    return {
      kind: 'background',
      label: `Background x${input.activeBackgroundTaskCount}`,
      color: 'cyan',
    };
  }
  if (input.hasPendingPrompt) {
    return {
      kind: 'queued',
      label: 'Queued',
      color: 'yellow',
    };
  }
  return {
    kind: 'idle',
    label: 'Idle',
    color: 'gray',
  };
}
