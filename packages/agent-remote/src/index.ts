/**
 * Remote System - Clean Atomic Architecture
 *
 * Exports using atomic components and pure functions
 */

// Main RemoteExecutor - Simple & Type Safe
export { SimpleRemoteExecutor as RemoteExecutor } from './client/remote-executor-simple';

// HTTP Client for advanced users
export { HttpClient } from './client/http-client';

// Atomic Types
export type {
  IBasicMessage,
  IResponseMessage,
  IRequestMessage,
  ITokenUsage,
} from './types/message-types';
export type { IHttpRequest, IHttpResponse, IHttpError, THttpMethod } from './types/http-types';

// Pure Utility Functions
export {
  toRequestMessage,
  toResponseMessage,
  createHttpRequest,
  createHttpResponse,
  extractContent,
  generateId,
  normalizeHeaders,
  safeJsonParse,
} from './utils/transformers';

// Type guards removed - use proper TypeScript types instead

// WebSocket Transport for real-time features
export { SimpleWebSocketTransport as WebSocketTransport } from './transport/websocket-transport-simple';

// Re-exports (shared contracts)
export type {
  IExecutor,
  IChatExecutionRequest,
  IStreamExecutionRequest,
  TUniversalMessage,
  IAssistantMessage,
  IRemoteExecutorConfig,
} from './shared/types';
