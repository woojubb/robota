/**
 * @robota-sdk/remote
 * 
 * Remote execution system for Robota SDK - enables secure server-side AI provider execution
 */

// Core interfaces and types
export type {
    ExecutorInterface,
    ChatExecutionRequest,
    StreamExecutionRequest,
    LocalExecutorConfig,
    RemoteExecutorConfig,
    CommunicationProtocol,
    RemoteConfig,
    HealthStatus,
    UserContext,
    ProviderStatus
} from './shared/types';

// Client components
export { RemoteExecutor } from './client/remote-executor';

// Server components
export { RemoteServer } from './server/remote-server';

// Core components
export { AIProviderEngine } from './core/ai-provider-engine';

// Transport components
export { HttpTransport } from './transport/http-transport';
export type { Transport, TransportCapabilities, TransportConfig } from './transport/transport-interface';

// Re-export types from agents for convenience
export type { UniversalMessage, AssistantMessage, ChatOptions, ToolSchema } from '@robota-sdk/agents'; 