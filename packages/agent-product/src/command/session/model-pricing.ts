import { calculateModelCost } from '@robota-sdk/agent-core';

/**
 * Returns USD cost, or undefined if the model is not in the pricing table.
 * Delegates to the agent-core pricing SSOT (`calculateModelCost`); this package owns only the
 * command-facing display helpers below.
 */
export function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  return calculateModelCost(modelId, inputTokens, outputTokens);
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
