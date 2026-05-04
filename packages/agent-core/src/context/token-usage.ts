import type { TUniversalMessage, TUniversalMessageMetadata } from '../interfaces/messages.js';

export interface IMessageTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens?: number;
}

interface IProviderUsageLike {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

type TMessageWithProviderUsage = TUniversalMessage & {
  readonly usage?: IProviderUsageLike;
};

/** Read normalized provider usage from a universal message when present. */
export function readTokenUsageFromMessage(
  message: TUniversalMessage,
): IMessageTokenUsage | undefined {
  const metadataUsage = readTokenUsageFromMetadata(message.metadata);
  const topLevelUsage = readTokenUsageFromProviderUsage(
    (message as TMessageWithProviderUsage).usage,
  );
  return metadataUsage ?? topLevelUsage;
}

export function readTokenUsageFromMetadata(
  metadata: TUniversalMessageMetadata | undefined,
): IMessageTokenUsage | undefined {
  if (!metadata) return undefined;

  const direct = readTokenUsageFromProviderUsage({
    inputTokens: numberFromMetadata(metadata, 'inputTokens'),
    outputTokens: numberFromMetadata(metadata, 'outputTokens'),
    promptTokens: numberFromMetadata(metadata, 'promptTokens'),
    completionTokens: numberFromMetadata(metadata, 'completionTokens'),
    totalTokens: numberFromMetadata(metadata, 'totalTokens'),
  });
  if (direct) return direct;

  const nested = metadata['usage'];
  if (typeof nested === 'string') {
    return readTokenUsageFromJson(nested);
  }
  if (isNumberRecord(nested)) {
    return readTokenUsageFromProviderUsage(nested);
  }
  return undefined;
}

function readTokenUsageFromJson(value: string): IMessageTokenUsage | undefined {
  try {
    const parsed = JSON.parse(value) as IProviderUsageLike;
    return readTokenUsageFromProviderUsage(parsed);
  } catch {
    return undefined;
  }
}

function readTokenUsageFromProviderUsage(
  usage: IProviderUsageLike | undefined,
): IMessageTokenUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = firstFiniteNumber(usage.inputTokens, usage.promptTokens);
  const outputTokens = firstFiniteNumber(usage.outputTokens, usage.completionTokens);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  const totalTokens = firstFiniteNumber(usage.totalTokens);
  return {
    inputTokens,
    outputTokens,
    ...(totalTokens !== undefined && { totalTokens }),
  };
}

function numberFromMetadata(
  metadata: TUniversalMessageMetadata,
  key: string,
): number | undefined {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstFiniteNumber(...values: Array<number | undefined>): number | undefined {
  return values.find(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
}

function isNumberRecord(
  value: TUniversalMessageMetadata[string] | undefined,
): value is Record<string, number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}
