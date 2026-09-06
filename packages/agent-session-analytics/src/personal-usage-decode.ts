import type { IHistoryEntry, IUniversalObjectValue, TUniversalValue } from '@robota-sdk/agent-core';
import type {
  IPersonalUsageActivity,
  IUsageObservation,
  IUsageSnapshot,
  IUsageSource,
} from '@robota-sdk/agent-interface-analytics';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

export interface INormalizedObservation {
  readonly id: string;
  readonly sessionId: string;
  readonly at: Date;
  readonly legacy: boolean;
  readonly observation: IUsageObservation;
}

export interface INormalizedActivity {
  readonly id: string;
  readonly sessionId: string;
  readonly key: string;
  readonly label: string;
  readonly kind: IPersonalUsageActivity['kind'];
  readonly at: Date;
}

function isRecord(value: TUniversalValue): value is IUniversalObjectValue {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

function optionalString(value: TUniversalValue): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isMetric(value: TUniversalValue): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isCostStatus(value: TUniversalValue): value is IUsageSnapshot['costStatus'] {
  return value === 'unknown' || value === 'estimated' || value === 'exact';
}

function hasValidOptionalMetrics(value: IUniversalObjectValue): boolean {
  return (
    (value['promptTokens'] === undefined || isMetric(value['promptTokens'])) &&
    (value['completionTokens'] === undefined || isMetric(value['completionTokens']))
  );
}

function hasValidCost(value: IUniversalObjectValue): boolean {
  const status = value['costStatus'];
  if (!isCostStatus(status)) return false;
  return status === 'unknown' ? value['costUsd'] === undefined : isMetric(value['costUsd']);
}

type TRequiredUsageMetrics = {
  readonly totalTokens: number;
  readonly contextUsedTokens: number;
  readonly contextMaxTokens: number;
  readonly contextUsedPercentage: number;
};

function hasRequiredMetrics(
  value: IUniversalObjectValue,
): value is IUniversalObjectValue & TRequiredUsageMetrics {
  return (
    isMetric(value['totalTokens']) &&
    isMetric(value['contextUsedTokens']) &&
    isMetric(value['contextMaxTokens']) &&
    isMetric(value['contextUsedPercentage'])
  );
}

function isUsageSurface(
  value: TUniversalValue,
): value is NonNullable<IUsageObservation['surface']> {
  return (
    value === 'cli' ||
    value === 'desktop-app' ||
    value === 'browser' ||
    value === 'remote' ||
    value === 'unknown'
  );
}

function usageSource(value: TUniversalValue): IUsageSource | undefined {
  if (!isRecord(value)) return undefined;
  const scope = value['scope'];
  if (
    scope !== 'main' &&
    scope !== 'subagent' &&
    scope !== 'background' &&
    scope !== 'tool' &&
    scope !== 'command' &&
    scope !== 'skill'
  ) {
    return undefined;
  }
  const id = optionalString(value['id']);
  const label = optionalString(value['label']);
  return { scope, ...(id ? { id } : {}), ...(label ? { label } : {}) };
}

function usageSnapshot(value: TUniversalValue): IUsageSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  if (value['kind'] !== 'exact' && value['kind'] !== 'estimated') return undefined;
  if (value['scope'] !== 'turn' || !hasValidOptionalMetrics(value) || !hasValidCost(value)) {
    return undefined;
  }
  if (!hasRequiredMetrics(value) || !isCostStatus(value['costStatus'])) {
    return undefined;
  }
  const source = usageSource(value['source']);
  return {
    kind: value['kind'],
    scope: 'turn',
    totalTokens: value['totalTokens'],
    contextUsedTokens: value['contextUsedTokens'],
    contextMaxTokens: value['contextMaxTokens'],
    contextUsedPercentage: value['contextUsedPercentage'],
    costStatus: value['costStatus'],
    ...(isMetric(value['promptTokens']) ? { promptTokens: value['promptTokens'] } : {}),
    ...(isMetric(value['completionTokens']) ? { completionTokens: value['completionTokens'] } : {}),
    ...(isMetric(value['costUsd']) ? { costUsd: value['costUsd'] } : {}),
    ...(source ? { source } : {}),
  };
}

function decodeObservation(value: TUniversalValue): IUsageObservation | undefined {
  if (!isRecord(value)) return undefined;
  const usageObservationId = optionalString(value['usageObservationId']);
  const turnId = optionalString(value['turnId']);
  const outcome = value['outcome'];
  if (
    !usageObservationId ||
    !turnId ||
    (outcome !== 'success' && outcome !== 'failure' && outcome !== 'interrupted')
  ) {
    return undefined;
  }
  const surface = value['surface'];
  const source = usageSource(value['source']);
  const usage = usageSnapshot(value['usage']);
  return {
    usageObservationId,
    turnId,
    outcome,
    ...(optionalString(value['modelId']) ? { modelId: optionalString(value['modelId']) } : {}),
    ...(optionalString(value['providerId'])
      ? { providerId: optionalString(value['providerId']) }
      : {}),
    ...(isUsageSurface(surface) ? { surface } : {}),
    ...(source ? { source } : {}),
    ...(usage ? { usage } : {}),
  };
}

function entryDate(entry: IHistoryEntry): Date | undefined {
  const at = new Date(entry.timestamp);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

export function normalizeRecord(record: IInteractiveSessionRecord): INormalizedObservation[] {
  const observations: INormalizedObservation[] = [];
  const history = record.history ?? [];
  const shadowedLegacyIds = new Set<string>();
  const unmatchedLegacy = history.flatMap((entry, index) => {
    if (entry.type !== 'usage-summary') return [];
    const usage = usageSnapshot(entry.data as TUniversalValue);
    return usage ? [{ id: entry.id, index, usage }] : [];
  });
  for (const [canonicalIndex, entry] of history.entries()) {
    if (entry.type !== 'usage-observation') continue;
    const canonical = decodeObservation(entry.data as TUniversalValue);
    if (!canonical?.usage) continue;
    const canonicalKey = JSON.stringify(canonical.usage);
    const candidates = unmatchedLegacy
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => JSON.stringify(candidate.usage) === canonicalKey)
      .sort(
        (left, right) =>
          Math.abs(left.candidate.index - canonicalIndex) -
          Math.abs(right.candidate.index - canonicalIndex),
      );
    const match = candidates[0];
    if (!match) continue;
    shadowedLegacyIds.add(match.candidate.id);
    unmatchedLegacy.splice(match.index, 1);
  }
  for (const entry of history) {
    const at = entryDate(entry);
    if (!at) continue;
    const observation =
      entry.type === 'usage-observation'
        ? decodeObservation(entry.data as TUniversalValue)
        : undefined;
    if (observation) {
      observations.push({
        id: observation.usageObservationId,
        sessionId: record.id,
        at,
        legacy: false,
        observation,
      });
      continue;
    }
    if (entry.type !== 'usage-summary' || shadowedLegacyIds.has(entry.id)) continue;
    const usage = usageSnapshot(entry.data as TUniversalValue);
    if (!usage) continue;
    const id = `legacy:${record.id}:${entry.id}`;
    observations.push({
      id,
      sessionId: record.id,
      at,
      legacy: true,
      observation: {
        usageObservationId: id,
        turnId: `legacy:${entry.id}`,
        outcome: 'success',
        usage,
        ...(usage.source ? { source: usage.source } : {}),
        surface: 'unknown',
      },
    });
  }
  return observations;
}

export function normalizeActivities(record: IInteractiveSessionRecord): INormalizedActivity[] {
  const activities: INormalizedActivity[] = [];
  for (const entry of record.history ?? []) {
    const data = entry.data as TUniversalValue;
    if (entry.type !== 'tool-start' || !isRecord(data)) continue;
    const toolName = optionalString(data['toolName']);
    const at = entryDate(entry);
    if (!toolName || !at) continue;
    activities.push({
      id: `tool:${record.id}:${entry.id}`,
      sessionId: record.id,
      key: `tool:${toolName}`,
      label: toolName,
      kind: 'tool',
      at,
    });
  }
  // Activation history mirrors this canonical source and is intentionally not counted again.
  for (const event of record.skillActivationEvents ?? []) {
    if (event.status !== 'started') continue;
    const at = new Date(event.timestamp);
    if (Number.isNaN(at.getTime())) continue;
    activities.push({
      id: `activation:${record.id}:${event.timestamp}:${event.source}:${event.qualifiedName ?? event.skillName}:${event.invocation}`,
      sessionId: record.id,
      key: event.qualifiedName ?? `${event.source}:${event.skillName}`,
      label: event.qualifiedName ?? event.skillName,
      kind: event.source,
      at,
    });
  }
  return activities;
}
