import type { TUniversalMessage } from '../interfaces/messages';
import { readTokenUsageFromMessage } from '../context/token-usage';

export interface IAssistantUsageMetadata {
  inputTokens: number;
  outputTokens: number;
  usage: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
  };
}

export function collectAssistantUsageMetadata(
  message: TUniversalMessage,
): IAssistantUsageMetadata | undefined {
  const usage = readTokenUsageFromMessage(message);
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
