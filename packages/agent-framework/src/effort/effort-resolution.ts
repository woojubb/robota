import {
  isModelEffort,
  MODEL_EFFORT_VALUES,
  type TModelEffort,
  type TUniversalValue,
} from '@robota-sdk/agent-core';

export type TEffortSelection = TModelEffort | 'auto';
export type TEffortSource =
  'command' | 'flag' | 'environment' | 'settings' | 'preset' | 'model-default';
export type TEffortDisposition = 'applied' | 'model-default' | 'clamped' | 'not-applied';

/**
 * #3282 §2 — the plain label for each effort selection, shared by every surface that reports an
 * effort choice or change: `/effort`'s own outcome text, the TUI/GUI pickers, and headless `/goal`
 * output (`transport-host/headless/headless-output.ts`). Lives here (not in `agent-command`, which
 * depends on this package) so `agent-framework`'s own headless output can use it without a circular
 * dependency; `agent-command`'s `effort-command.ts` re-exports it unchanged.
 */
export const EFFORT_LEVEL_LABELS: Readonly<Record<TEffortSelection, string>> = {
  auto: 'Auto',
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Maximum',
};

export interface IModelEffortResolution {
  readonly requested: TEffortSelection;
  readonly effective: TModelEffort;
  readonly source: TEffortSource;
  readonly disposition: TEffortDisposition;
  readonly modelDefault: TModelEffort;
  readonly reason?: string;
}

export interface IModelEffortInputs {
  readonly command?: TEffortSelection;
  readonly flag?: TEffortSelection;
  readonly environment?: TEffortSelection;
  readonly settings?: TEffortSelection;
  readonly preset?: TEffortSelection;
  readonly modelDefault: TModelEffort;
}

/** Validate an untrusted effort value at a CLI, environment, or settings boundary. */
export function parseModelEffort(
  value: TUniversalValue | undefined,
  optionName = '--effort',
): TEffortSelection | undefined {
  if (value === undefined) return undefined;
  if (value === 'auto' || isModelEffort(value)) return value;
  throw new Error(
    `Invalid ${optionName} "${String(value)}". Valid: auto | ${MODEL_EFFORT_VALUES.join(' | ')}`,
  );
}

/** Resolve one provider-neutral effort request using the single documented precedence order. */
export function resolveModelEffort(inputs: IModelEffortInputs): IModelEffortResolution {
  const candidates: readonly [TEffortSource, TEffortSelection | undefined][] = [
    ['command', inputs.command],
    ['flag', inputs.flag],
    ['environment', inputs.environment],
    ['settings', inputs.settings],
    ['preset', inputs.preset],
  ];
  const selected = candidates.find(([, value]) => value !== undefined);
  const source: TEffortSource = selected?.[0] ?? 'model-default';
  const requested: TEffortSelection = selected?.[1] ?? 'auto';
  const effective = requested === 'auto' ? inputs.modelDefault : requested;
  return {
    requested,
    effective,
    source,
    disposition: requested === 'auto' ? 'model-default' : 'applied',
    modelDefault: inputs.modelDefault,
  };
}
