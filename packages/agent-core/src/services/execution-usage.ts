import type { TUniversalMessage, TUniversalMessageMetadata } from '../interfaces/messages';

export interface IAssistantUsageMetadata {
  inputTokens: number;
  outputTokens: number;
  usage: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
  };
}

interface IProviderUsageLike {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

type TMessageWithProviderUsage = TUniversalMessage & {
  usage?: IProviderUsageLike;
};

export function collectAssistantUsageMetadata(
  message: TUniversalMessage,
): IAssistantUsageMetadata | undefined {
  const metadataUsage = readUsageFromMetadata(message.metadata);
  const topLevelUsage = readUsageFromProviderUsage((message as TMessageWithProviderUsage).usage);
  const usage = metadataUsage ?? topLevelUsage;
  if (!usage) return undefined;

  const totalTokens = usage.totalTokens ?? usage.inputTokens + usage.outputTokens;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    usage: {
      totalTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    },
  };
}

function readUsageFromMetadata(
  metadata: TUniversalMessageMetadata | undefined,
): { inputTokens: number; outputTokens: number; totalTokens?: number } | undefined {
  if (!metadata) return undefined;

  const direct = readUsageFromProviderUsage({
    inputTokens: numberFromMetadata(metadata, 'inputTokens'),
    outputTokens: numberFromMetadata(metadata, 'outputTokens'),
    promptTokens: numberFromMetadata(metadata, 'promptTokens'),
    completionTokens: numberFromMetadata(metadata, 'completionTokens'),
    totalTokens: numberFromMetadata(metadata, 'totalTokens'),
  });
  if (direct) return direct;

  const nested = metadata['usage'];
  if (typeof nested === 'string') {
    return readUsageFromJson(nested);
  }
  if (isNumberRecord(nested)) {
    return readUsageFromProviderUsage(nested);
  }
  return undefined;
}

function readUsageFromJson(
  value: string,
): { inputTokens: number; outputTokens: number; totalTokens?: number } | undefined {
  try {
    const parsed = JSON.parse(value) as IProviderUsageLike;
    return readUsageFromProviderUsage(parsed);
  } catch {
    return undefined;
  }
}

function readUsageFromProviderUsage(
  usage: IProviderUsageLike | undefined,
): { inputTokens: number; outputTokens: number; totalTokens?: number } | undefined {
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

function numberFromMetadata(metadata: TUniversalMessageMetadata, key: string): number | undefined {
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
