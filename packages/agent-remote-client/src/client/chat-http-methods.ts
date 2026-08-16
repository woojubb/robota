/**
 * Chat HTTP methods — non-streaming and streaming chat request execution.
 *
 * Extracted from http-client.ts to keep each file under 300 lines.
 * These are pure functions that accept the configuration and logger they need.
 */

import { validateToolCallArray } from './chat-tool-call-validation';
import { createHttpResponse, generateId, toResponseMessage } from '../utils/transformers';

import type { IHttpResponse } from '../types/http-types';
import type { IBasicMessage, IResponseMessage } from '../types/message-types';
import type { ILogger, IToolSchema, IToolCall } from '@robota-sdk/agent-core';

/** Shape of a message sent in chat request body, including optional tool-related fields */
export interface IChatRequestMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  toolCalls?: IToolCall[];
  toolCallId?: string;
}

/** Shape of the response payload from the chat endpoint.
 * The server returns a flat TUniversalMessage (role/content at top level). */
export interface IChatResponsePayload {
  id?: string;
  role?: string;
  content?: string;
  toolCalls?: IToolCall[];
  state?: string;
  timestamp?: string;
  usage?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
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
  signal?: AbortSignal,
): Promise<IResponseMessage> {
  const mappedMessages = mapMessages(messages);

  const requestData: Record<string, unknown> = {
    messages: mappedMessages,
    provider,
    model,
    ...(tools && tools.length > 0 && { tools }),
  };

  logger.debug('HTTP non-streaming request', { toolCount: tools?.length ?? 0 });

  const url = `${baseUrl}/chat`;

  try {
    const fetchResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(requestData),
      // CORE-042: the remote path is a provider call like any other, and it was the one that could
      // not be cancelled -- `fetch` was called with no `signal`, so an aborted run left the request
      // in flight and the turn waiting on it. The per-call options the body should also carry are
      // CORE-044; this is only the half that is client-local and that the cancellation contract
      // depends on.
      ...(signal && { signal }),
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

    // Server returns a flat TUniversalMessage: { role, content, toolCalls?, ... }
    const responsePayload = httpResponse.data;

    const rawRole = responsePayload?.role;
    // The server response always returns an assistant message role
    const role: IChatRequestMessage['role'] =
      rawRole === 'user' || rawRole === 'assistant' || rawRole === 'system' || rawRole === 'tool'
        ? rawRole
        : 'assistant';

    const content = typeof responsePayload?.content === 'string' ? responsePayload.content : '';

    const assistantMessage: IChatRequestMessage = {
      role,
      content,
    };

    // Preserve toolCalls when available (array of tool call fragments)
    if (responsePayload?.toolCalls && Array.isArray(responsePayload.toolCalls)) {
      assistantMessage.toolCalls = validateToolCallArray(responsePayload.toolCalls);
    }

    return toResponseMessage(assistantMessage, provider, model);
  } catch (error) {
    // An abort is the caller's own decision, not a transport failure: rewrapping it as
    // `Request failed` would erase the `AbortError` name every cancellation check reads.
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw new Error(`Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
