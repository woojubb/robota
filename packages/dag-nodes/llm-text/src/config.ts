import { z } from 'zod';

export const DEFAULT_TEMPERATURE = 0.2;
export const CHARS_PER_TOKEN_ESTIMATE = 4;
/**
 * Fallback per-token cost (USD) used for estimation only when the selected provider definition carries no
 * `costPerTokenUsd`. Matches the former router's flat estimate so cost behavior is preserved for providers
 * whose cost is unknown.
 */
export const FALLBACK_COST_PER_TOKEN_USD = 0.003;

/** A single provider entry in the routing list. `provider` is a registry type (no hardcoded union). */
export const ProviderEntrySchema = z.object({
  provider: z.string().min(1),
  model: z.string().optional(),
  priority: z.number().int().positive().default(1),
});

/**
 * Config for the collapsed llm-text node. Either the single-provider shorthand (`provider` [+ `model`]) or
 * the multi-provider routing list (`providers`) must be present. `options` is passed through to the resolved
 * provider config (ARCH-PROVIDER-003 TC-07).
 */
export const LlmTextConfigSchema = z.object({
  provider: z.string().min(1).optional(),
  providers: z.array(ProviderEntrySchema).optional(),
  model: z.string().optional(),
  temperature: z.number().default(DEFAULT_TEMPERATURE),
  maxTokens: z.number().int().positive().optional(),
  maxCostUsd: z.number().positive().optional(),
  baseCredits: z.number().default(0),
  strategy: z.enum(['priority-fallback', 'round-robin']).default('priority-fallback'),
  options: z.record(z.unknown()).optional(),
});

export type TLlmTextConfig = z.output<typeof LlmTextConfigSchema>;

export interface IResolvedEntry {
  provider: string;
  model?: string;
  priority: number;
}

export interface ISkip {
  provider: string;
  reason: 'unknown-provider' | 'no-model' | 'no-credential' | 'model-not-allowed';
}

export function formatSkips(skips: readonly ISkip[]): string {
  return skips.map((s) => `${s.provider} (${s.reason})`).join(', ');
}

export function buildAgentSummary(
  usedProvider: string,
  model: string,
  attempted: readonly string[],
  wordCount: number,
): string {
  const fallbackLabel =
    attempted.length > 1 ? ` (fallback from ${attempted.slice(0, -1).join(', ')})` : '';
  return `Used: ${usedProvider}${fallbackLabel} — Generated ${wordCount} words. Model: ${model}.`;
}
