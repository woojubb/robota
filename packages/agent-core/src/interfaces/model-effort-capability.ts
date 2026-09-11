/** Provider-neutral native effort controls. `auto` is selection state, not a control. */
export type TModelEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Runtime boundary vocabulary for a concrete provider-native effort control. */
export const MODEL_EFFORT_VALUES = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly TModelEffort[];

export function isModelEffort(value: TUniversalValue | undefined): value is TModelEffort {
  return typeof value === 'string' && MODEL_EFFORT_VALUES.includes(value as TModelEffort);
}

/** A caller can preserve provider-default selection without serializing a native control. */
export type TModelEffortSelection = TModelEffort | 'auto';

/** The verified effort facts an adapter declares for one exact model identifier. */
export interface IModelEffortCapability {
  supportedEfforts: readonly TModelEffort[];
  defaultEffort: TModelEffort;
  /** Adapter-owned opaque identity for the verified native control. */
  nativeControlId: string;
}

/** Source-dated provider data. Core owns the shape but never provides the data. */
export interface IProviderModelEffortTable {
  verifiedAt: string;
  sourceUrl: string;
  models: Readonly<Record<string, IModelEffortCapability>>;
}

export type TModelEffortDisposition = 'exact' | 'clamped' | 'model-default' | 'not-applied';

/** Serializable output of resolving a selection against a verified provider table. */
export interface IModelEffortResolution {
  selection: TModelEffortSelection;
  effective: TModelEffort | null;
  disposition: TModelEffortDisposition;
  fingerprint: string;
}

/** Whether the adapter serialized a verified native effort control. */
export type TModelEffortNativeControl =
  | { readonly state: 'sent'; readonly id: string }
  | { readonly state: 'omitted'; readonly reason: string };

/** Whether an endpoint dispatch occurred after the effort decision. */
export type TModelEffortProviderDispatch =
  { readonly state: 'sent' } | { readonly state: 'not-dispatched'; readonly reason: string };

/** Serializable terminal result of one effort-bearing provider request. */
export interface IModelEffortOutcome {
  readonly resolution: IModelEffortResolution;
  readonly nativeControl: TModelEffortNativeControl;
  readonly providerDispatch: TModelEffortProviderDispatch;
}

/** Local observer for a request's one terminal provider effort outcome. */
export type TModelEffortOutcomeCallback = (outcome: IModelEffortOutcome) => void;

/** Construct the three-fact terminal outcome without conflating its states. */
export function createModelEffortOutcome(
  resolution: IModelEffortResolution,
  outcome: Omit<IModelEffortOutcome, 'resolution'>,
): IModelEffortOutcome {
  return { resolution, ...outcome };
}

const EFFORT_ORDER = new Map(MODEL_EFFORT_VALUES.map((effort, index) => [effort, index]));

function unresolved(selection: TModelEffortSelection, modelId: string): IModelEffortResolution {
  return {
    selection,
    effective: null,
    disposition: 'not-applied',
    fingerprint: `${modelId}|${selection}|not-applied`,
  };
}

/**
 * Resolve only adapter-declared facts. Missing provider/model data never becomes a guessed default.
 */
export function resolveModelEffort(
  table: IProviderModelEffortTable | undefined,
  modelId: string,
  selection: TModelEffortSelection,
): IModelEffortResolution {
  const capability = table?.models[modelId];
  if (!capability) return unresolved(selection, modelId);

  const fingerprint = (effective: TModelEffort, disposition: TModelEffortDisposition): string =>
    `${modelId}|${selection}|${effective}|${disposition}|${capability.nativeControlId}|${table.verifiedAt}`;

  if (selection === 'auto') {
    if (!capability.supportedEfforts.includes(capability.defaultEffort)) {
      return unresolved(selection, modelId);
    }
    return {
      selection,
      effective: capability.defaultEffort,
      disposition: 'model-default',
      fingerprint: fingerprint(capability.defaultEffort, 'model-default'),
    };
  }

  if (capability.supportedEfforts.includes(selection)) {
    return {
      selection,
      effective: selection,
      disposition: 'exact',
      fingerprint: fingerprint(selection, 'exact'),
    };
  }

  const requestedOrder = EFFORT_ORDER.get(selection);
  const fallback = capability.supportedEfforts
    .filter(
      (effort) => (EFFORT_ORDER.get(effort) ?? Number.POSITIVE_INFINITY) < (requestedOrder ?? -1),
    )
    .at(-1);
  if (!fallback) return unresolved(selection, modelId);

  return {
    selection,
    effective: fallback,
    disposition: 'clamped',
    fingerprint: fingerprint(fallback, 'clamped'),
  };
}
import type { TUniversalValue } from './types';
