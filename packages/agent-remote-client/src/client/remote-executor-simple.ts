/**
 * Simple RemoteExecutor - Composed from Atomic Components
 *
 * Facade pattern using pure functions and atomic types
 */

import { randomUUID } from 'node:crypto';

import { SilentLogger } from '@robota-sdk/agent-core';

import { HttpClient, type IHttpClientConfig } from './http-client';

import type { IBasicMessage } from '../types/message-types';
import type {
  TUniversalMessage,
  IAssistantMessage,
  IStreamExecutionRequest,
  IChatExecutionRequest,
  IExecutor,
  ILogger,
} from '@robota-sdk/agent-core';

// Simple inline type checking instead of external type guards
const DEFAULT_TIMEOUT_MS = 30000;

function validateChatExecutionRequest(
  request: IChatExecutionRequest | IStreamExecutionRequest,
): void {
  if (!request.messages || request.messages.length === 0) {
    throw new Error('Messages array is required and cannot be empty');
  }

  if (!request.provider) {
    throw new Error('Provider is required');
  }

  if (!request.model) {
    throw new Error('Model is required');
  }

  for (let i = 0; i < request.messages.length; i++) {
    const msg = request.messages[i];
    if (typeof msg.role !== 'string' || typeof msg.content !== 'string') {
      throw new Error(`Invalid message at index ${i}: role and content must be strings`);
    }
  }
}

/** Configuration for connecting a SimpleRemoteExecutor to a remote AI server. */
export interface ISimpleRemoteConfig {
  serverUrl: string;
  userApiKey: string;
  timeout?: number;
  headers?: Record<string, string>;
  /** Enable WebSocket for real-time communication */
  enableWebSocket?: boolean;
  /** WebSocket endpoint path (defaults to /ws/playground) */
  websocketPath?: string;
  /** Auto-reconnect WebSocket on disconnect */
  autoReconnect?: boolean;
  /** Logger instance for dependency injection */
  logger?: ILogger;
}

/** Simplified execution request containing messages, provider, and model. */
export interface ISimpleExecutionRequest {
  messages: IBasicMessage[];
  provider: string;
  model: string;
}

/**
 * Simple RemoteExecutor using atomic components
 * Implements IExecutor for full compatibility with LocalExecutor
 */
export class SimpleRemoteExecutor implements IExecutor {
  readonly name = 'remote';
  readonly version = '1.0.0';

  private readonly httpClient: HttpClient;
  private readonly logger: ILogger;
  private readonly config: ISimpleRemoteConfig;

  constructor(config: ISimpleRemoteConfig) {
    this.config = config;
    // Validate configuration
    this.validateConfig();

    // Initialize logger with dependency injection pattern
    this.logger = config.logger || SilentLogger;

    // Create HTTP client with timeout and headers
    const httpConfig: IHttpClientConfig = {
      baseUrl: config.serverUrl,
      timeout: config.timeout || DEFAULT_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.userApiKey}`,
        ...config.headers,
      },
      logger: this.logger,
    };

    this.httpClient = new HttpClient(httpConfig);
  }

  /**
   * Execute chat request (IExecutor compatible)
   */
  async executeChat(request: IChatExecutionRequest): Promise<IAssistantMessage> {
    validateChatExecutionRequest(request);

    this.logger.debug('SimpleRemoteExecutor.executeChat called', {
      hasTools: !!request.tools,
      toolsCount: request.tools?.length || 0,
    });

    this.logger.debug('Using IExecutor format (non-streaming)');
    const messages = request.messages;
    const provider = request.provider;
    const model = request.model;

    // CORE-044: the whole options object, not just the signal. `LocalExecutor` has always forwarded
    // `request.options`; the remote executor dropped everything but the tools, so the same agent
    // behaved differently depending on which executor it was configured with.
    const response = await this.httpClient.chat(
      messages,
      provider,
      model,
      request.tools,
      request.options,
    );

    // Convert IResponseMessage to IAssistantMessage (IExecutor requirement)
    const assistantMessage: IAssistantMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: response.content || '',
      state: 'complete' as const,
      timestamp: new Date(),
    };

    if (response.toolCalls) {
      assistantMessage.toolCalls = response.toolCalls;
    }

    return assistantMessage;
  }

  /**
   * Remote streaming — restored by CORE-046, on a route the server actually serves.
   *
   * CORE-044 had removed this. It posted to `${baseUrl}/stream`, a sibling module named
   * `/chat/stream`, and no server here served either spelling, so every call was a 404 dressed as a
   * capability — green in the suite only because the tests mocked `fetch`. It could not simply be
   * reconnected, because it yielded RAW provider chunks and relied on a fragment assembler that
   * CORE-042 deleted with the second execution engine.
   *
   * What makes it safe now is that the SERVER assembles. `/api/v1/remote/chat/stream` calls
   * `provider.chat(messages, { onTextDelta })` — already every provider's contract — so the wire
   * carries text deltas plus one terminal ASSEMBLED message, and tool-call fragments never cross it.
   * There is one assembler in the world and it is the provider's.
   *
   * This generator therefore does the small half: hand each delta to the caller's `onTextDelta` and
   * yield the terminal message. Yielding ONE message rather than a message per delta is deliberate —
   * `IExecutor.executeChatStream` yields `TUniversalMessage`, and a partial message is not one; the
   * live text is what `onTextDelta` is for, and the turn has consumed it that way since CORE-042.
   */
  async *executeChatStream(request: IStreamExecutionRequest): AsyncIterable<TUniversalMessage> {
    const messages = request.messages.map((message) => ({
      role: message.role,
      content: typeof message.content === 'string' ? message.content : '',
    }));

    const response = await this.httpClient.chatStream(
      messages,
      request.provider,
      request.model,
      (delta) => request.options?.onTextDelta?.(delta),
      request.tools,
      request.options,
    );

    const assembled: IAssistantMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: response.content || '',
      state: 'complete' as const,
      timestamp: new Date(),
    };
    if (response.toolCalls) {
      assembled.toolCalls = response.toolCalls;
    }
    yield assembled;
  }

  /**
   * Check if the executor supports tool calling (IExecutor requirement)
   */
  supportsTools(): boolean {
    return true;
  }

  /**
   * Validate executor configuration (IExecutor requirement)
   */
  validateConfig(): boolean {
    if (!this.config.serverUrl) {
      throw new Error('BaseURL is required but not provided');
    }
    if (!this.config.userApiKey) {
      throw new Error('User API key is required but not provided');
    }
    return true;
  }

  /**
   * Clean up resources (IExecutor requirement)
   */
  async dispose(): Promise<void> {
    // Cleanup any resources if needed
    this.logger.debug('SimpleRemoteExecutor disposed');
  }
}
