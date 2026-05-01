import type OpenAI from 'openai';
import type { IChatOptions, ILogger, TUniversalMessage } from '@robota-sdk/agent-core';
import { OpenAICompatibleResponseParser } from '@robota-sdk/agent-provider-openai-compatible';
import { projectGemmaReasoningText } from './reasoning-projector';
import { createGemmaToolCallProjector } from './tool-call-projector';

export function parseGemmaChatCompletion(
  response: OpenAI.Chat.ChatCompletion,
  logger: ILogger,
  options: IChatOptions | undefined,
): TUniversalMessage {
  const rawContent = response.choices?.[0]?.message.content || '';
  const parser = new OpenAICompatibleResponseParser({
    logger,
    ...(options?.tools && {
      toolCallTextProjector: createGemmaToolCallProjector(options.tools),
    }),
  });
  const parsed = parser.parseResponse(response);
  const projection = projectGemmaReasoningText(parsed.content ?? '');

  return withGemmaProjectionMetadata(
    {
      ...parsed,
      content: projection.visibleText,
    },
    rawContent,
    projection.removedReasoning,
  );
}

export function withGemmaProjectionMetadata(
  message: TUniversalMessage,
  rawContent: string,
  removedReasoning: boolean,
): TUniversalMessage {
  if (!removedReasoning) {
    return message;
  }

  return {
    ...message,
    metadata: {
      ...(message.metadata ?? {}),
      gemmaReasoningFiltered: true,
      gemmaRawContent: rawContent,
    },
  };
}
