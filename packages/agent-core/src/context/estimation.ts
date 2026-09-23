import { readTokenUsageFromMessage } from './token-usage.js';

import type { TUniversalMessage } from '../interfaces/messages.js';
import type { IToolSchema } from '../interfaces/tool-schema.js';

export const CONTEXT_ESTIMATE_CHARS_PER_TOKEN = 4;

export interface IContextTokenEstimateOptions {
  readonly usageFloorTokens?: number;
}

export interface IContextTokenEstimate {
  readonly usedTokens: number;
  readonly serializedTokens: number;
  readonly providerTokens?: number;
  readonly usageFloorTokens?: number;
}

export function estimateSerializedContextTokens(messages: readonly TUniversalMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / CONTEXT_ESTIMATE_CHARS_PER_TOKEN);
}

/**
 * CLI-1990: what a set of tool schemas costs on every request, by the same chars-per-token heuristic
 * the message estimate uses — a serialised schema is what the adapters put on the wire. An empty set
 * costs nothing, stated rather than left to the two-character `[]`.
 */
export function estimateToolSchemaTokens(schemas: readonly IToolSchema[]): number {
  if (schemas.length === 0) return 0;
  return Math.ceil(JSON.stringify(schemas).length / CONTEXT_ESTIMATE_CHARS_PER_TOKEN);
}

export function estimateContextTokensFromMessages(
  messages: readonly TUniversalMessage[],
  options: IContextTokenEstimateOptions = {},
): IContextTokenEstimate {
  const serializedTokens = estimateSerializedContextTokens(messages);
  const providerEstimate = readLatestProviderTokens(messages);
  const providerTokens = providerEstimate?.tokens;
  const usageFloorTokens = normalizeUsageFloorTokens(options.usageFloorTokens);
  const providerUsageIsTerminal = providerEstimate?.index === messages.length - 1;
  const usedTokens = providerUsageIsTerminal
    ? Math.max(providerTokens ?? 0, usageFloorTokens ?? 0)
    : Math.max(serializedTokens, providerTokens ?? 0, usageFloorTokens ?? 0);

  return {
    usedTokens,
    serializedTokens,
    ...(providerTokens !== undefined && { providerTokens }),
    ...(usageFloorTokens !== undefined && { usageFloorTokens }),
  };
}

function readLatestProviderTokens(
  messages: readonly TUniversalMessage[],
): { tokens: number; index: number } | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const usage = readTokenUsageFromMessage(messages[index]);
    if (usage) {
      return {
        tokens: usage.totalTokens ?? usage.inputTokens + usage.outputTokens,
        index,
      };
    }
  }
  return undefined;
}

function normalizeUsageFloorTokens(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.ceil(value);
}
