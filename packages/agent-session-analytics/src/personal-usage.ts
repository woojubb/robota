import {
  normalizeActivities,
  normalizeRecord,
  type INormalizedActivity,
  type INormalizedObservation,
} from './personal-usage-decode.js';

import type {
  IPersonalUsageDimension,
  IPersonalUsageActivity,
  IPersonalUsageReport,
  IPersonalUsageRequest,
  IPersonalUsageTotals,
  IUsageSource,
} from '@robota-sdk/agent-interface-analytics';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const SHORT_PERIOD_DAYS = 7;
const LONG_PERIOD_DAYS = 30;
const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length;

export interface IPersonalUsageSnapshot {
  readonly request: IPersonalUsageRequest;
  readonly now: Date;
  readonly records: readonly IInteractiveSessionRecord[];
  readonly corruptSessionIds?: readonly string[];
  readonly unsupportedSessionIds?: readonly string[];
}

interface IMutableTotals {
  sessions: Set<string>;
  observations: number;
  turns: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  hasUnknownCost: boolean;
  hasEstimatedCost: boolean;
}

function createMutableTotals(): IMutableTotals {
  return {
    sessions: new Set<string>(),
    observations: 0,
    turns: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    hasUnknownCost: false,
    hasEstimatedCost: false,
  };
}

function dateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function calendarKeys(now: Date, timezone: string, count: number): string[] {
  // First resolve the current LOCAL date (also validates the IANA timezone), then perform date-only
  // arithmetic in UTC. Subtracting 24-hour instants can skip a local calendar date during the first
  // hour after a spring-forward transition; date-only arithmetic cannot.
  const [year, month, day] = dateKey(now, timezone).split('-').map(Number);
  const localDate = new Date(Date.UTC(year!, month! - 1, day!));
  return Array.from({ length: count }, (_, index) => {
    const value = new Date(localDate);
    value.setUTCDate(value.getUTCDate() - (count - index - 1));
    return value.toISOString().slice(0, ISO_DATE_LENGTH);
  });
}

function activityDimensions(items: readonly INormalizedActivity[]): IPersonalUsageActivity[] {
  const counts = new Map<string, { item: INormalizedActivity; count: number }>();
  for (const item of items) {
    const current = counts.get(item.key);
    counts.set(item.key, { item, count: (current?.count ?? 0) + 1 });
  }
  return [...counts.values()]
    .map(({ item, count }) => ({
      key: item.key,
      label: item.label,
      kind: item.kind,
      count,
    }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function addObservation(target: IMutableTotals, item: INormalizedObservation): void {
  const usage = item.observation.usage;
  target.sessions.add(item.sessionId);
  target.observations += 1;
  if (!item.legacy) target.turns += 1;
  target.promptTokens += usage?.promptTokens ?? 0;
  target.completionTokens += usage?.completionTokens ?? 0;
  target.totalTokens += usage?.totalTokens ?? 0;
  target.costUsd += usage?.costUsd ?? 0;
  if (!usage || usage.costStatus === 'unknown') target.hasUnknownCost = true;
  if (usage?.costStatus === 'estimated') target.hasEstimatedCost = true;
}

function freezeTotals(totals: IMutableTotals): IPersonalUsageTotals {
  return {
    sessions: totals.sessions.size,
    turns: totals.turns,
    promptTokens: totals.promptTokens,
    completionTokens: totals.completionTokens,
    totalTokens: totals.totalTokens,
    costUsd: totals.costUsd,
    costStatus:
      totals.observations === 0 || totals.hasUnknownCost
        ? 'unknown'
        : totals.hasEstimatedCost
          ? 'estimated'
          : 'exact',
  };
}

function dimensions(
  items: readonly INormalizedObservation[],
  keyOf: (item: INormalizedObservation) => string,
): IPersonalUsageDimension[] {
  const groups = new Map<string, IMutableTotals>();
  for (const item of items) {
    const key = keyOf(item);
    const totals = groups.get(key) ?? createMutableTotals();
    addObservation(totals, item);
    groups.set(key, totals);
  }
  return [...groups.entries()]
    .map(([key, totals]) => {
      const frozen = freezeTotals(totals);
      return { key, label: key, frozen, sessionIds: [...totals.sessions].sort() };
    })
    .map(({ key, label, frozen, sessionIds }) => ({
      key,
      label,
      turns: frozen.turns,
      promptTokens: frozen.promptTokens,
      completionTokens: frozen.completionTokens,
      totalTokens: frozen.totalTokens,
      costUsd: frozen.costUsd,
      costStatus: frozen.costStatus,
      sessionIds,
    }))
    .sort(
      (left, right) => right.totalTokens - left.totalTokens || left.key.localeCompare(right.key),
    );
}

function sourceKey(source: IUsageSource | undefined): string {
  if (!source) return 'unknown';
  return source.id ? `${source.scope}:${source.id}` : source.scope;
}

interface ISelectedUsage {
  readonly observations: INormalizedObservation[];
  readonly activities: INormalizedActivity[];
  readonly duplicateObservations: number;
  readonly legacyObservations: number;
}

function isIncluded(at: Date, input: IPersonalUsageSnapshot, dates: ReadonlySet<string>): boolean {
  return at.getTime() <= input.now.getTime() && dates.has(dateKey(at, input.request.timezone));
}

function selectUsage(input: IPersonalUsageSnapshot, dates: ReadonlySet<string>): ISelectedUsage {
  const observations: INormalizedObservation[] = [];
  const activities: INormalizedActivity[] = [];
  const seenObservations = new Set<string>();
  const seenActivities = new Set<string>();
  let duplicateObservations = 0;
  let legacyObservations = 0;
  for (const record of input.records) {
    for (const item of normalizeRecord(record)) {
      if (!isIncluded(item.at, input, dates)) continue;
      if (seenObservations.has(item.id)) {
        duplicateObservations += 1;
        continue;
      }
      seenObservations.add(item.id);
      observations.push(item);
      if (item.legacy) legacyObservations += 1;
    }
    for (const activity of normalizeActivities(record)) {
      if (!isIncluded(activity.at, input, dates) || seenActivities.has(activity.id)) continue;
      seenActivities.add(activity.id);
      activities.push(activity);
    }
  }
  return { observations, activities, duplicateObservations, legacyObservations };
}

function accumulateUsage(
  input: IPersonalUsageSnapshot,
  keys: readonly string[],
  selection: ISelectedUsage,
): { totals: IMutableTotals; byDay: Map<string, IMutableTotals> } {
  const totals = createMutableTotals();
  const byDay = new Map(keys.map((key) => [key, createMutableTotals()]));
  for (const item of selection.observations) {
    addObservation(totals, item);
    addObservation(byDay.get(dateKey(item.at, input.request.timezone))!, item);
  }
  for (const activity of selection.activities) {
    totals.sessions.add(activity.sessionId);
    byDay.get(dateKey(activity.at, input.request.timezone))?.sessions.add(activity.sessionId);
  }
  return { totals, byDay };
}

export function summarizePersonalUsage(input: IPersonalUsageSnapshot): IPersonalUsageReport {
  const count = input.request.period === '30d' ? LONG_PERIOD_DAYS : SHORT_PERIOD_DAYS;
  const keys = calendarKeys(input.now, input.request.timezone, count);
  const selection = selectUsage(input, new Set(keys));
  const { totals, byDay } = accumulateUsage(input, keys, selection);
  const selected = selection.observations;

  return {
    schemaVersion: 1,
    generatedAt: input.now.toISOString(),
    period: input.request.period,
    timezone: input.request.timezone,
    interval: { startDate: keys[0]!, endDate: keys.at(-1)! },
    totals: freezeTotals(totals),
    daily: keys.map((date, index) => ({
      date,
      partial: index === keys.length - 1,
      totals: freezeTotals(byDay.get(date)!),
      sessionIds: [...byDay.get(date)!.sessions].sort(),
    })),
    byModel: dimensions(selected, (item) => item.observation.modelId ?? 'unknown'),
    byProvider: dimensions(selected, (item) => item.observation.providerId ?? 'unknown'),
    bySurface: dimensions(selected, (item) => item.observation.surface ?? 'unknown'),
    bySource: dimensions(selected, (item) => sourceKey(item.observation.source)),
    byActivity: activityDimensions(selection.activities),
    sessionIds: [...totals.sessions].sort(),
    coverage: {
      validSessions: input.records.length,
      corruptSessions: input.corruptSessionIds?.length ?? 0,
      unsupportedSessions: input.unsupportedSessionIds?.length ?? 0,
      duplicateObservations: selection.duplicateObservations,
      legacyObservations: selection.legacyObservations,
      unknownModelObservations: selected.filter((item) => !item.observation.modelId).length,
      unknownProviderObservations: selected.filter((item) => !item.observation.providerId).length,
      unknownSurfaceObservations: selected.filter(
        (item) => !item.observation.surface || item.observation.surface === 'unknown',
      ).length,
      corruptSessionIds: [...(input.corruptSessionIds ?? [])].sort(),
      unsupportedSessionIds: [...(input.unsupportedSessionIds ?? [])].sort(),
    },
  };
}
