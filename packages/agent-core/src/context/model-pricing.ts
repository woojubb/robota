/**
 * Model pricing — SSOT for per-model token cost.
 *
 * Sibling of `models.ts` (which owns context-window/output metadata). Consumers that need to
 * compute or estimate cost (cost display, budget/rate limiting) must read from here rather than
 * embedding their own price tables.
 *
 * Prices are USD per 1,000,000 tokens (as of May 2026 — update when providers change rates).
 */

export interface IModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

const TOKENS_PER_MILLION = 1_000_000;
const TOKENS_PER_THOUSAND = 1_000;
const BLEND_DIVISOR = 2;

/** Exact per-model prices, keyed by API model ID. */
export const MODEL_PRICES: Record<string, IModelPrice> = {
  // Anthropic Claude 4
  'claude-opus-4-7': { inputPerMillion: 15, outputPerMillion: 75 },
  'claude-opus-4-5': { inputPerMillion: 15, outputPerMillion: 75 },
  'claude-sonnet-4-6': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-sonnet-4-5': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-haiku-4-5': { inputPerMillion: 0.8, outputPerMillion: 4 },
  // Anthropic Claude 3
  'claude-3-5-sonnet-20241022': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-3-5-haiku-20241022': { inputPerMillion: 0.8, outputPerMillion: 4 },
  'claude-3-opus-20240229': { inputPerMillion: 15, outputPerMillion: 75 },
  // OpenAI
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  o1: { inputPerMillion: 15, outputPerMillion: 60 },
  'o1-mini': { inputPerMillion: 3, outputPerMillion: 12 },
  o3: { inputPerMillion: 10, outputPerMillion: 40 },
  'o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  // DeepSeek
  'deepseek-chat': { inputPerMillion: 0.14, outputPerMillion: 0.28 },
  'deepseek-reasoner': { inputPerMillion: 0.55, outputPerMillion: 2.19 },
  // Google Gemini
  'gemini-2.0-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'gemini-2.0-flash-thinking': { inputPerMillion: 0.35, outputPerMillion: 3.5 },
  'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5 },
  'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
};

/** Family-level fallback prices for unrecognized exact IDs (matched in order). */
const PATTERN_PRICES: Array<{ pattern: RegExp; price: IModelPrice }> = [
  { pattern: /claude-opus/i, price: { inputPerMillion: 15, outputPerMillion: 75 } },
  { pattern: /claude-sonnet/i, price: { inputPerMillion: 3, outputPerMillion: 15 } },
  { pattern: /claude-haiku/i, price: { inputPerMillion: 0.8, outputPerMillion: 4 } },
  { pattern: /gpt-4o-mini/i, price: { inputPerMillion: 0.15, outputPerMillion: 0.6 } },
  { pattern: /gpt-4/i, price: { inputPerMillion: 2.5, outputPerMillion: 10 } },
  { pattern: /deepseek/i, price: { inputPerMillion: 0.14, outputPerMillion: 0.28 } },
  { pattern: /gemini-2/i, price: { inputPerMillion: 0.1, outputPerMillion: 0.4 } },
  { pattern: /gemini-1/i, price: { inputPerMillion: 1.25, outputPerMillion: 5 } },
];

/** Resolve a model's price by exact ID, then family pattern. Returns undefined if unknown. */
export function lookupModelPrice(modelId: string): IModelPrice | undefined {
  const exact = MODEL_PRICES[modelId];
  if (exact) return exact;
  for (const { pattern, price } of PATTERN_PRICES) {
    if (pattern.test(modelId)) return price;
  }
  return undefined;
}

/** Exact USD cost for an input/output token split, or undefined if the model is unknown. */
export function calculateModelCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const price = lookupModelPrice(modelId);
  if (!price) return undefined;
  return (
    (inputTokens / TOKENS_PER_MILLION) * price.inputPerMillion +
    (outputTokens / TOKENS_PER_MILLION) * price.outputPerMillion
  );
}

/**
 * Blended USD-per-1000-tokens rate for budget estimation when an input/output split is not
 * available (e.g. rate limiting). Averages the input and output per-million prices. Returns
 * undefined if the model is unknown so callers can apply their own fallback rate.
 */
export function estimateBlendedCostPer1000(modelId: string): number | undefined {
  const price = lookupModelPrice(modelId);
  if (!price) return undefined;
  return (price.inputPerMillion + price.outputPerMillion) / BLEND_DIVISOR / TOKENS_PER_THOUSAND;
}
