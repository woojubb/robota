/**
 * HTTP Client - Simple & Type Safe
 *
 * Clean HTTP client using atomic components for maximum type safety
 */

import type { IHttpRequest, IHttpResponse, TDefaultRequestData } from '../types/http-types';
import type { ILogger, IToolSchema } from '@robota-sdk/agent-core';
import { SilentLogger } from '@robota-sdk/agent-core';
import type { IBasicMessage, IResponseMessage } from '../types/message-types';
import { createHttpRequest, createHttpResponse, generateId } from '../utils/transformers';
import { executeChatRequest, executeChatStreamRequest } from './chat-http-methods';

export interface IHttpClientConfig {
  baseUrl: string;
  timeout: number;
  headers: Record<string, string>;
  logger?: ILogger;
}

/**
 * Simple HTTP Client for Remote Communication
 */
export class HttpClient {
  private config: IHttpClientConfig;
  private readonly logger: ILogger;

  constructor(config: IHttpClientConfig) {
    this.config = config;
    this.logger = config.logger || SilentLogger;
  }

  /**
   * Send POST request with type safety
   */
  async post<TData extends TDefaultRequestData, TResponse>(
    endpoint: string,
    data: TData,
  ): Promise<IHttpResponse<TResponse>> {
    const request = createHttpRequest(
      generateId('post'),
      `${this.config.baseUrl}${endpoint}`,
      'POST',
      data,
      this.config.headers,
    );

    return await this.executeRequest<TResponse>(request);
  }

  /**
   * Send GET request with type safety
   */
  async get<TResponse>(endpoint: string): Promise<IHttpResponse<TResponse>> {
    const request = createHttpRequest<undefined>(
      generateId('get'),
      `${this.config.baseUrl}${endpoint}`,
      'GET',
      undefined,
      this.config.headers,
    );

    return await this.executeRequest<TResponse>(request);
  }

  /**
   * Execute chat request specifically
   */
  async chat(
    messages: IBasicMessage[],
    provider: string,
    model: string,
    tools?: IToolSchema[],
  ): Promise<IResponseMessage> {
    return executeChatRequest(
      this.config.baseUrl,
      this.config.headers,
      this.logger,
      messages,
      provider,
      model,
      tools,
    );
  }

  /**
   * Execute streaming chat request
   */
  async *chatStream(
    messages: IBasicMessage[],
    provider: string,
    model: string,
    tools?: IToolSchema[],
  ): AsyncGenerator<IResponseMessage> {
    yield* executeChatStreamRequest(
      this.config.baseUrl,
      this.logger,
      messages,
      provider,
      model,
      tools,
    );
  }

  /**
   * Execute HTTP request with error handling
   */
  private async executeRequest<TResponse>(
    request: IHttpRequest<TDefaultRequestData> | IHttpRequest<undefined>,
  ): Promise<IHttpResponse<TResponse>> {
    try {
      // Convert IHttpHeaders (string | undefined values) to Record<string, string>
      const safeHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (value !== undefined) {
          safeHeaders[key] = value;
        }
      }

      const requestInit: RequestInit = {
        method: request.method,
        headers: safeHeaders,
      };

      // Only include `body` when request data is explicitly provided.
      // This preserves type-safety and keeps GET requests truly body-less.
      if (request.data !== undefined) {
        requestInit.body = JSON.stringify(request.data);
      }

      const fetchResponse = await fetch(request.url, requestInit);

      if (!fetchResponse.ok) {
        throw new Error(`HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`);
      }

      // Trust boundary: fetchResponse.json() returns unknown.
      // Callers of executeRequest are responsible for validating the shape.
      const responseData: unknown = await fetchResponse.json();

      return createHttpResponse<TResponse>(
        request.id,
        fetchResponse.status,
        responseData as TResponse,
        this.getResponseHeaders(fetchResponse),
      );
    } catch (error) {
      throw new Error(
        `Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Extract response headers safely
   */
  private getResponseHeaders(response: Response): Record<string, string> {
    const headers: Record<string, string> = {};

    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return headers;
  }

  /**
   * Validate configuration
   */
  validateConfig(): boolean {
    return (
      typeof this.config.baseUrl === 'string' &&
      this.config.baseUrl.length > 0 &&
      typeof this.config.timeout === 'number' &&
      this.config.timeout > 0 &&
      typeof this.config.headers === 'object' &&
      this.config.headers !== null
    );
  }
}
