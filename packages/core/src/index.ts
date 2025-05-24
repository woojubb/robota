// Main Robota class
export { Robota } from './robota';
export type { RobotaOptions } from './robota';

// Interfaces
export type {
    AIProvider,
    Context,
    Message,
    MessageRole,
    FunctionCall,
    ModelResponse,
    StreamingResponseChunk
} from './interfaces/ai-provider';
export type { Logger } from './interfaces/logger';

// Types
export type {
    FunctionSchema,
    FunctionCallResult,
    FunctionDefinition,
    RunOptions,
    ProviderOptions
} from './types';

// Memory
export { SimpleMemory, PersistentSystemMemory } from './memory';
export type { Memory } from './memory';

// Tool Provider
export type { ToolProvider } from './tool-provider';

// Managers (available for direct external use when needed)
export { AIProviderManager } from './managers/ai-provider-manager';
export { ToolProviderManager } from './managers/tool-provider-manager';
export { SystemMessageManager } from './managers/system-message-manager';
export { FunctionCallManager } from './managers/function-call-manager';
export type { FunctionCallConfig, FunctionCallMode } from './managers/function-call-manager';

// Services
export { ConversationService } from './services/conversation-service';

// Utilities
export { logger } from './utils';

// Legacy features (for backward compatibility)
export * from './providers/openai-provider';

// Required items from function.ts
export {
    createFunction,
    functionFromCallback,
    createFunctionSchema,
    FunctionRegistry,
    FunctionHandler,
    Function,
    FunctionOptions,
    FunctionResult
} from './function'; 