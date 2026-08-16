/**
 * Streaming chat HTTP method — SSE request execution against the streaming chat endpoint.
 *
 * Split from chat-http-methods.ts to keep each file under 300 lines: the SSE frame reader is a
 * distinct responsibility from the single-response POST, and only this half owns the wire framing.
 *
 * NOTE (CORE-044): the endpoint this posts to is not served anywhere in this repository, and is
 * spelled differently again in request-handler-simple.ts. That item owns the decision of whether the
 * route is implemented or this client is deleted; it is recorded here so the next reader of this
 * file does not have to rediscover it.
 */

import { validateToolCallArray } from './chat-tool-call-validation';
import { toResponseMessage } from '../utils/transformers';

import type { IBasicMessage, IResponseMessage } from '../types/message-types';
import type { ILogger, IToolSchema } from '@robota-sdk/agent-core';

const SSE_DATA_PREFIX_LENGTH = 6;
const CONTENT_PREVIEW_LENGTH = 30;

/**
 * Execute a streaming POST to the /stream endpoint, yielding IResponseMessage chunks.
 */
export async function* executeChatStreamRequest(
  baseUrl: string,
  logger: ILogger,
  messages: IBasicMessage[],
  provider: string,
  model: string,
  tools?: IToolSchema[],
  signal?: AbortSignal,
): AsyncGenerator<IResponseMessage> {
  const url = `${baseUrl}/stream`;
  const body = {
    messages,
    provider,
    model,
    ...(tools && tools.length > 0 && { tools }),
  };

  logger.debug('HTTP stream request', {
    toolCount: tools?.length ?? 0,
    url,
    provider,
    model,
    messagesCount: messages.length,
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      ...(signal && { signal }),
    });

    logger.debug('HTTP response', { status: response.status, statusText: response.statusText });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('HTTP error response', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      });
      throw new Error(`HTTP ${response.status}: ${response.statusText}\n${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;

          if (line.startsWith('data: ')) {
            const data = line.slice(SSE_DATA_PREFIX_LENGTH);
            if (data === '[DONE]') {
              return;
            }

            try {
              const parsed = JSON.parse(data) as Record<string, unknown>;

              // The server sends the raw TUniversalMessage; no unwrapping is needed.
              const responseData = parsed;

              if (responseData && responseData['role'] === 'assistant') {
                const contentValue =
                  typeof responseData['content'] === 'string' ? responseData['content'] : '';
                const toolCalls = responseData['toolCalls'];

                logger.debug('parsed stream chunk', {
                  role: String(responseData['role']),
                  content: contentValue.substring(0, CONTENT_PREVIEW_LENGTH),
                  hasToolCalls: !!toolCalls,
                  toolCallsLength: Array.isArray(toolCalls) ? toolCalls.length : 0,
                });

                yield toResponseMessage(
                  {
                    role: 'assistant',
                    content: contentValue,
                    // Always forward toolCalls when present (including empty id fragments)
                    ...(Array.isArray(toolCalls) && {
                      toolCalls: validateToolCallArray(toolCalls),
                    }),
                  },
                  provider,
                  model,
                );
              }
            } catch (_parseError) {
              // Skip invalid JSON
              continue;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw new Error(
      `Streaming request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
