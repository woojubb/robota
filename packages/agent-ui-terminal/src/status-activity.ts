/**
 * SCREEN-2002: this module is pure, so it names a colour TOKEN, not a colour. `StatusBar` resolves
 * the token against the live theme — a pure function that returned a chalk name could not follow one.
 */
export type TStatusActivityKind = 'tools' | 'thinking' | 'background' | 'queued' | 'idle';

export interface IStatusActivityInput {
  isThinking: boolean;
  activeToolCount: number;
  activeBackgroundTaskCount: number;
  hasPendingPrompt: boolean;
}

/** The `IThemeColors['text']` key a status activity is rendered in. */
export type TStatusActivityTone = 'accent' | 'warning' | 'muted';

export interface IStatusActivity {
  kind: TStatusActivityKind;
  label: string;
  tone: TStatusActivityTone;
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
      tone: 'accent',
    };
  }
  if (input.isThinking) {
    return {
      kind: 'thinking',
      label: 'Thinking',
      tone: 'warning',
    };
  }
  if (input.activeBackgroundTaskCount > NO_ACTIVE_ITEMS) {
    return {
      kind: 'background',
      label: `Background (${input.activeBackgroundTaskCount})`,
      tone: 'accent',
    };
  }
  if (input.hasPendingPrompt) {
    return {
      kind: 'queued',
      label: 'Queued',
      tone: 'warning',
    };
  }
  return {
    kind: 'idle',
    label: 'Idle',
    tone: 'muted',
  };
}
