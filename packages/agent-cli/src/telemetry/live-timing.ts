import type { ILivePromptDurationTotal, ILivePromptQueueSummary } from '@robota-sdk/agent-interface-analytics';

interface IProjectedTimingTotals {
  provider?: ILivePromptDurationTotal;
  tool?: ILivePromptDurationTotal;
  queue?: ILivePromptQueueSummary;
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function duration(value: unknown): ILivePromptDurationTotal | undefined {
  const data = record(value);
  if (!data || !count(data.durationMs) || !count(data.samples) || !count(data.invalid) ||
    (data.samples === 0 && data.durationMs !== 0)) return undefined;
  return { durationMs: data.durationMs, samples: data.samples, invalid: data.invalid };
}

/** Allowlisted numeric evidence only, even when an embedding host passes an untyped batch. */
export function projectLiveTimingTotals(value: unknown): IProjectedTimingTotals | undefined {
  const data = record(value);
  if (!data) return undefined;
  const provider = duration(data.provider), tool = duration(data.tool), queueDuration = duration(data.queue);
  const queueData = record(data.queue);
  const queue = queueDuration && queueData && count(queueData.admissionStarted) && count(queueData.notDispatched) &&
    queueData.admissionStarted + queueData.notDispatched === queueDuration.samples
    ? { ...queueDuration, admissionStarted: queueData.admissionStarted, notDispatched: queueData.notDispatched } : undefined;
  if (!provider && !tool && !queue) return undefined;
  return { ...(provider ? { provider } : {}), ...(tool ? { tool } : {}), ...(queue ? { queue } : {}) };
}

export function liveTimingAttributes(value: unknown): Record<string, number> {
  const totals = projectLiveTimingTotals(value);
  const attributes: Record<string, number> = {};
  for (const kind of ['provider', 'tool', 'queue'] as const) {
    const total = totals?.[kind];
    if (!total) continue;
    attributes[`agent.timing.${kind}.duration_ms`] = total.durationMs;
    attributes[`agent.timing.${kind}.samples`] = total.samples;
    attributes[`agent.timing.${kind}.invalid`] = total.invalid;
  }
  if (totals?.queue) {
    attributes['agent.timing.queue.admission_started'] = totals.queue.admissionStarted;
    attributes['agent.timing.queue.not_dispatched'] = totals.queue.notDispatched;
  }
  return attributes;
}
