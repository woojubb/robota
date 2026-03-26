/**
 * Remote Client — calls a remote Robota agent over HTTP.
 *
 * Server-side code has been moved to agent-transport-http.
 * This package is client-only: RemoteExecutor + HttpClient.
 */

// Main RemoteExecutor
export { SimpleRemoteExecutor as RemoteExecutor } from './client/remote-executor-simple.js';

// HTTP Client for advanced users
export { HttpClient } from './client/http-client.js';

// Types
export type {
  IBasicMessage,
  IResponseMessage,
  IRequestMessage,
  ITokenUsage,
} from './types/message-types.js';
export type { IHttpRequest, IHttpResponse, IHttpError, THttpMethod } from './types/http-types.js';

// Utility functions
export {
  toRequestMessage,
  toResponseMessage,
  createHttpRequest,
  createHttpResponse,
  extractContent,
  generateId,
  normalizeHeaders,
  safeJsonParse,
} from './utils/transformers.js';

// Re-exports (shared contracts from agent-core)
export type {
  IExecutor,
  IChatExecutionRequest,
  IStreamExecutionRequest,
  TUniversalMessage,
  IAssistantMessage,
  IRemoteExecutorConfig,
} from './shared/types.js';
