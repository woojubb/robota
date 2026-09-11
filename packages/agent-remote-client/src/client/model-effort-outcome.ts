/** Runtime validation for the server-owned API-001 terminal outcome envelope. */

import { isModelEffort } from '@robota-sdk/agent-core';

import type {
  IModelEffortOutcome,
  IModelEffortResolution,
  IUniversalObjectValue,
  TModelEffortDisposition,
  TModelEffortNativeControl,
  TModelEffortProviderDispatch,
  TUniversalValue,
} from '@robota-sdk/agent-core';

function isRecord(value: TUniversalValue | undefined): value is IUniversalObjectValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseResolution(value: TUniversalValue | undefined): IModelEffortResolution | undefined {
  if (!isRecord(value)) return undefined;
  const { selection, effective, disposition, fingerprint } = value;
  if (
    (selection !== 'auto' && !isModelEffort(selection)) ||
    (effective !== null && !isModelEffort(effective)) ||
    !isDisposition(disposition) ||
    typeof fingerprint !== 'string'
  ) {
    return undefined;
  }
  return { selection, effective, disposition, fingerprint };
}

function isDisposition(value: TUniversalValue): value is TModelEffortDisposition {
  return (
    typeof value === 'string' &&
    ['exact', 'clamped', 'model-default', 'not-applied'].includes(value)
  );
}

function parseNativeControl(
  value: TUniversalValue | undefined,
): TModelEffortNativeControl | undefined {
  if (!isRecord(value)) return undefined;
  if (value['state'] === 'sent' && typeof value['id'] === 'string') {
    return { state: 'sent', id: value['id'] };
  }
  if (value['state'] === 'omitted' && typeof value['reason'] === 'string') {
    return { state: 'omitted', reason: value['reason'] };
  }
  return undefined;
}

function parseProviderDispatch(
  value: TUniversalValue | undefined,
): TModelEffortProviderDispatch | undefined {
  if (!isRecord(value)) return undefined;
  if (value['state'] === 'sent') return { state: 'sent' };
  if (value['state'] === 'not-dispatched' && typeof value['reason'] === 'string') {
    return { state: 'not-dispatched', reason: value['reason'] };
  }
  return undefined;
}

/**
 * Parse the only outcome shape that may cause a local observer to run. The remote client transports
 * this server value; it must not turn malformed JSON into a fabricated application result.
 */
export function parseModelEffortOutcome(value: TUniversalValue): IModelEffortOutcome | undefined {
  if (!isRecord(value)) return undefined;
  const resolution = parseResolution(value['resolution']);
  const nativeControl = parseNativeControl(value['nativeControl']);
  const providerDispatch = parseProviderDispatch(value['providerDispatch']);
  if (!resolution || !nativeControl || !providerDispatch) return undefined;
  return { resolution, nativeControl, providerDispatch };
}
