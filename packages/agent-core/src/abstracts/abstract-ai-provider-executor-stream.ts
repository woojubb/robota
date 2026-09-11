import { executeChatStreamViaExecutor } from './ai-provider-helpers';

import type { IExecutor, TExecutorStreamEvent } from '../interfaces/executor';
import type { TUniversalMessage } from '../interfaces/messages';
import type { IChatOptions, IToolSchema } from '../interfaces/provider';
import type { ILogger } from '../utils/logger';

/** Log and delegate a provider streaming call through its configured executor. */
export async function* executeProviderStreamViaExecutor(
  logger: ILogger,
  executor: IExecutor | undefined,
  providerName: string,
  messages: TUniversalMessage[],
  options?: IChatOptions,
): AsyncIterable<TExecutorStreamEvent> {
  logger.debug?.(
    '🔍 [TOOL-FLOW] AbstractAIProvider.executeStreamViaExecutorOrDirect() - Executor request',
    {
      provider: providerName,
      model: options?.model,
      hasTools: !!options?.tools,
      toolsCount: options?.tools?.length || 0,
      toolNames: options?.tools?.map((tool: IToolSchema) => tool.name) || [],
    },
  );
  yield* executeChatStreamViaExecutor(executor, providerName, messages, options);
}
