/**
 * Remote System - Clean Atomic Architecture
 * 
 * Exports using atomic components and pure functions
 */

// Main RemoteExecutor - Simple & Type Safe
export { SimpleRemoteExecutor as RemoteExecutor } from './client/remote-executor-simple';

// HTTP Client Facade for advanced users
export { HttpClientFacade } from './client/http-client-facade';

// Atomic Types
export type { BasicMessage, ResponseMessage, RequestMessage, TokenUsage } from './types/message-types';
export type { HttpRequest, HttpResponse, HttpError, HttpMethod } from './types/http-types';

// Pure Utility Functions
export {
    toRequestMessage,
    toResponseMessage,
    createHttpRequest,
    createHttpResponse,
    extractContent,
    generateId,
    normalizeHeaders,
    safeJsonParse
} from './utils/transformers';

// Type Guards
export {
    isBasicMessage,
    isResponseMessage,
    isHttpResponse,
    isHttpError,
    isString,
    isNumber,
    isObject
} from './utils/type-guards';

// WebSocket Transport for real-time features
export { SimpleWebSocketTransport as WebSocketTransport } from './transport/websocket-transport-simple';

// Legacy compatibility exports
export type {
    ExecutorInterface,
    ChatExecutionRequest,
    StreamExecutionRequest,
    UniversalMessage,
    AssistantMessage,
    RemoteExecutorConfig
} from './shared/types'; 