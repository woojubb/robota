/**
 * Chat HTTP methods — non-streaming and streaming chat request execution.
 *
 * Extracted from http-client.ts to keep each file under 300 lines.
 * These are pure functions that accept the configuration and logger they need.
 */

import type { ILogger, IToolSchema, IToolCall } from '@robota-sdk/agent-core';
import type { IBasicMessage, IResponseMessage } from '../types/message-types';
import type { IHttpResponse } from '../types/http-types';
import { createHttpResponse, generateId, toResponseMessage } from '../utils/transformers';

const SSE_DATA_PREFIX_LENGTH = 6;
const CONTENT_PREVIEW_LENGTH = 30;

/** Shape of a message sent in chat request body, including optional tool-related fields */
export interface IChatRequestMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  toolCalls?: IToolCall[];
  toolCallId?: string;
}

/** Shape of the response payload from the chat endpoint */
export interface IChatResponsePayload {
  success?: boolean;
  data?: {
    role?: string;
    content?: string;
    toolCalls?: IToolCall[];
  };
  provider?: string;
  model?: string;
}

/**
 * Validate that an array of unknown values conforms to IToolCall[].
 * Filters out entries that do not have the required shape.
 */
export function validateToolCallArray(items: unknown[]): IToolCall[] {
  return items.filter(
    (item): item is IToolCall =>
      typeof item === 'object' &&
      item !== null &&
      'id' in item &&
      typeof (item as Record<string, unknown>)['id'] === 'string' &&
      'type' in item &&
      (item as Record<string, unknown>)['type'] === 'function' &&
      'function' in item &&
      typeof (item as Record<string, unknown>)['function'] === 'object' &&
      (item as Record<string, unknown>)['function'] !== null,
  );
}

/**
 * Map IBasicMessage array to IChatRequestMessage array, preserving
 * toolCalls and toolCallId where present.
 */
function mapMessages(messages: IBasicMessage[]): IChatRequestMessage[] {
  return messages.map((msg): IChatRequestMessage => {
    const mapped: IChatRequestMessage = {
      role: msg.role,
      content: msg.content,
    };
    // Narrow via property presence check — IBasicMessage may carry extra
    // fields (toolCalls, toolCallId) that are not in the base interface.
    if (msg.role === 'assistant' && 'toolCalls' in msg) {
      const toolCalls = (msg as unknown as Record<string, unknown>)['toolCalls'];
      if (Array.isArray(toolCalls)) {
        mapped.toolCalls = validateToolCallArray(toolCalls);
      }
    }
    if (msg.role === 'tool' && 'toolCallId' in msg) {
      const toolCallId = (msg as unknown as Record<string, unknown>)['toolCallId'];
      if (typeof toolCallId === 'string') {
        mapped.toolCallId = toolCallId;
      }
    }
    return mapped;
  });
}

/**
 * Execute a non-streaming POST to the /chat endpoint and return an IResponseMessage.
 */
export async function executeChatRequest(
  baseUrl: string,
  headers: Record<string, string>,
  logger: ILogger,
  messages: IBasicMessage[],
  provider: string,
  model: string,
  tools?: IToolSchema[],
): Promise<IResponseMessage> {
  const mappedMessages = mapMessages(messages);

  const requestData: Record<string, unknown> = {
    messages: mappedMessages,
    provider,
    model,
    ...(tools && tools.length > 0 && { tools }),
  };

  logger.info('🔧 [HTTP-CLIENT] Non-streaming request tools:', tools?.length || 0);

  const url = `${baseUrl}/chat`;

  try {
    const fetchResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(requestData),
    });

    if (!fetchResponse.ok) {
      throw new Error(`HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`);
    }

    // Trust boundary: caller validates the response shape
    const responseData: unknown = await fetchResponse.json();

    const httpResponse: IHttpResponse<IChatResponsePayload> =
      createHttpResponse<IChatResponsePayload>(
        generateId('post'),
        fetchResponse.status,
        responseData as IChatResponsePayload,
        extractResponseHeaders(fetchResponse),
      );

    // Extract assistant message preserving toolCalls if present
    const responsePayload = httpResponse.data;
    const dataMessage = responsePayload?.data;

    const rawRole = dataMessage?.role;
    // The server response always returns an assistant message role
    const role: IChatRequestMessage['role'] =
      rawRole === 'user' || rawRole === 'assistant' || rawRole === 'system' || rawRole === 'tool'
        ? rawRole
        : 'assistant';

    const content = typeof dataMessage?.content === 'string' ? dataMessage.content : '';

    const assistantMessage: IChatRequestMessage = {
      role,
      content,
    };

    // Preserve toolCalls when available (array of tool call fragments)
    if (dataMessage?.toolCalls && Array.isArray(dataMessage.toolCalls)) {
      assistantMessage.toolCalls = validateToolCallArray(dataMessage.toolCalls);
    }

    const providerName =
      typeof responsePayload?.provider === 'string' ? responsePayload.provider : undefined;
    const modelName =
      typeof responsePayload?.model === 'string' ? responsePayload.model : undefined;

    return toResponseMessage(assistantMessage, providerName, modelName);
  } catch (error) {
    throw new Error(`Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

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
): AsyncGenerator<IResponseMessage> {
  const url = `${baseUrl}/stream`;
  const body = {
    messages,
    provider,
    model,
    ...(tools && tools.length > 0 && { tools }),
  };

  logger.info('🔧 [HTTP-CLIENT] Request tools:', tools?.length || 0);
  logger.info('🌐 HTTP chatStream request:', {
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
    });

    logger.info('🌐 HTTP response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('❌ HTTP error response:', {
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

                // Debug: inspect parsed data
                logger.debug('🔍 [HTTP-CLIENT-PARSE] Parsed response data:', {
                  role: String(responseData['role']),
                  content: contentValue.substring(0, CONTENT_PREVIEW_LENGTH) + '...',
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
    throw new Error(
      `Streaming request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Extract response headers from a fetch Response into a plain record.
 */
function extractResponseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}
