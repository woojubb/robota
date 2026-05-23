/** USD prices per 1,000,000 tokens (as of May 2026 — update when providers change rates). */
interface IModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

const MODEL_PRICES: Record<string, IModelPrice> = {
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

function lookupPrice(modelId: string): IModelPrice | undefined {
  const exact = MODEL_PRICES[modelId];
  if (exact) return exact;
  for (const { pattern, price } of PATTERN_PRICES) {
    if (pattern.test(modelId)) return price;
  }
  return undefined;
}

/** Returns USD cost, or undefined if the model is not in the pricing table. */
export function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const price = lookupPrice(modelId);
  if (!price) return undefined;
  return (
    (inputTokens / 1_000_000) * price.inputPerMillion +
    (outputTokens / 1_000_000) * price.outputPerMillion
  );
}

/** Format a USD amount for display (e.g. "$0.0043"). */
export function formatUsd(amount: number): string {
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

/** Format a token count with comma separators (e.g. "45,000"). */
export function formatTokens(count: number): string {
  return count.toLocaleString('en-US');
}
