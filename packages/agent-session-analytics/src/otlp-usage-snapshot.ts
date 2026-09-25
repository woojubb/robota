import { createOtlpPromptRootTraces } from './otlp-prompt-root-traces.js';
import { normalizeRecord } from './personal-usage-decode.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

/** A non-additive, content-free snapshot. Consumers must read the latest Gauge, not sum exports. */
export function createOtlpUsageSnapshot(
  records: readonly IInteractiveSessionRecord[],
  at: Date,
  version: string,
): { resourceMetrics: unknown[] } {
  const seen = new Set<string>();
  let turns = 0;
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let unknownTokenSplitObservations = 0;
  let knownCost = 0;
  let unknownCostObservations = 0;
  let estimatedCostObservations = 0;

  for (const record of records) {
    for (const item of normalizeRecord(record)) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (!item.legacy) turns += 1;
      const usage = item.observation.usage;
      if (!usage) {
        unknownCostObservations += 1;
        unknownTokenSplitObservations += 1;
        continue;
      }
      totalTokens += usage.totalTokens;
      inputTokens += usage.promptTokens ?? 0;
      outputTokens += usage.completionTokens ?? 0;
      if (usage.promptTokens === undefined || usage.completionTokens === undefined) {
        unknownTokenSplitObservations += 1;
      }
      if (usage.costStatus === 'unknown' || usage.costUsd === undefined) {
        unknownCostObservations += 1;
      } else {
        knownCost += usage.costUsd;
        if (usage.costStatus === 'estimated') estimatedCostObservations += 1;
      }
    }
  }
  // The trace projection is the single accepted-call selector: parent/time/duplicate checks must
  // agree between traces and metrics. These are separate non-additive Gauges, never turn totals.
  const acceptedCalls = createOtlpPromptRootTraces(records, version);
  const calls = acceptedCalls.callMetrics;

  const timeUnixNano = String(BigInt(at.getTime()) * 1_000_000n);
  const gauge = (name: string, unit: string, value: number) => ({
    name,
    unit,
    gauge: { dataPoints: [{ timeUnixNano, asDouble: value }] },
  });

  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'robota' } },
            { key: 'service.version', value: { stringValue: version } },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: '@robota-sdk/agent-session-analytics' },
            metrics: [
              gauge('robota.session.count', '{session}', records.length),
              gauge('robota.turn.count', '{turn}', turns),
              gauge('robota.token.total', '{token}', totalTokens),
              gauge('robota.token.input.known', '{token}', inputTokens),
              gauge('robota.token.output.known', '{token}', outputTokens),
              gauge(
                'robota.token.split_unknown_observations',
                '{observation}',
                unknownTokenSplitObservations,
              ),
              gauge('robota.cost.usd.known', 'USD', knownCost),
              gauge('robota.cost.unknown_observations', '{observation}', unknownCostObservations),
              gauge(
                'robota.cost.estimated_observations',
                '{observation}',
                estimatedCostObservations,
              ),
              gauge('robota.provider_call.count', '{call}', calls.invoked),
              gauge('robota.provider_call.usage.complete_count', '{call}', calls.completeUsage),
              gauge('robota.provider_call.token.input.known', '{token}', calls.inputTokens),
              gauge('robota.provider_call.token.output.known', '{token}', calls.outputTokens),
              gauge('robota.provider_call.cost.usd.estimated', 'USD', calls.estimatedCostUsd),
              gauge('robota.provider_call.cost.unknown_count', '{call}', calls.unknownCost),
              gauge('robota.provider_call.usage.partial_count', '{call}', acceptedCalls.coverage.providerUsage.partial),
              gauge('robota.provider_call.usage.invalid_count', '{call}', acceptedCalls.coverage.providerUsage.invalid),
              gauge('robota.provider_call.usage.legacy_count', '{call}', acceptedCalls.coverage.providerUsage.legacy),
              gauge('robota.provider_call.price.exact_id_count', '{call}', calls.exactPriceMatches),
              gauge('robota.provider_call.price.family_fallback_count', '{call}', calls.familyPriceMatches),
            ],
          },
        ],
      },
    ],
  };
}
