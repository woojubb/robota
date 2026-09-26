import type { TUniversalMessage } from '../interfaces/messages';

export type TProviderUsageProvenance = 'complete' | 'partial' | 'absent';

export interface IVerifiedProviderCallUsage {
  readonly provenance: TProviderUsageProvenance;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  /** The part of `promptTokens` served from the provider's prompt cache, when it was reported. */
  readonly cacheReadTokens?: number;
}

/** Keep billing/telemetry stricter than context-window heuristics: only adapter-attested totals count. */
export function verifiedProviderCallUsage(message: TUniversalMessage | undefined): IVerifiedProviderCallUsage {
  const marker = message?.metadata?.['usageProvenance'];
  if (marker === 'partial') return { provenance: 'partial' };
  if (marker !== 'complete') return { provenance: 'absent' };

  const topLevel = (message as TUniversalMessage & {
    usage?: {
      promptTokens?: unknown;
      completionTokens?: unknown;
      totalTokens?: unknown;
      cacheReadTokens?: unknown;
    };
  }).usage;
  const metadata = message?.metadata;
  const promptTokens = topLevel?.promptTokens ?? metadata?.['promptTokens'] ?? metadata?.['inputTokens'];
  const completionTokens = topLevel?.completionTokens ?? metadata?.['completionTokens'] ?? metadata?.['outputTokens'];
  const totalTokens = topLevel?.totalTokens ?? metadata?.['totalTokens'];
  const cacheReadTokens = topLevel?.cacheReadTokens ?? metadata?.['cacheReadTokens'];
  if (
    typeof promptTokens !== 'number' || !Number.isSafeInteger(promptTokens) || promptTokens < 0 ||
    typeof completionTokens !== 'number' || !Number.isSafeInteger(completionTokens) || completionTokens < 0 ||
    !Number.isSafeInteger(promptTokens + completionTokens) ||
    (totalTokens !== undefined && totalTokens !== promptTokens + completionTokens)
  ) return { provenance: 'absent' };

  return {
    provenance: 'complete',
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    // A cache read is a subset of the prompt; a count outside [0, promptTokens] is not attested.
    ...(typeof cacheReadTokens === 'number' &&
      Number.isSafeInteger(cacheReadTokens) &&
      cacheReadTokens >= 0 &&
      cacheReadTokens <= promptTokens && { cacheReadTokens }),
  };
}
