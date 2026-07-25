import { PALETTE } from './tui-palette.js';

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
      label: `Tools (${input.activeToolCount})`,
      color: PALETTE.text.accent,
    };
  }
  if (input.isThinking) {
    return {
      kind: 'thinking',
      label: 'Thinking',
      color: PALETTE.text.warning,
    };
  }
  if (input.activeBackgroundTaskCount > NO_ACTIVE_ITEMS) {
    return {
      kind: 'background',
      label: `Background (${input.activeBackgroundTaskCount})`,
      color: PALETTE.text.accent,
    };
  }
  if (input.hasPendingPrompt) {
    return {
      kind: 'queued',
      label: 'Queued',
      color: PALETTE.text.warning,
    };
  }
  return {
    kind: 'idle',
    label: 'Idle',
    color: PALETTE.text.muted,
  };
}
