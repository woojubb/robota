// 메인 Robota 클래스
export { Robota } from './robota';
export type { RobotaOptions } from './robota';

// 인터페이스들
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

// 타입들
export type {
    FunctionSchema,
    FunctionCallResult,
    FunctionDefinition,
    RunOptions,
    ProviderOptions
} from './types';

// 메모리
export { SimpleMemory, PersistentSystemMemory } from './memory';
export type { Memory } from './memory';

// Tool Provider
export type { ToolProvider } from './tool-provider';

// 매니저들 (필요시 외부에서 직접 사용 가능)
export { AIProviderManager } from './managers/ai-provider-manager';
export { ToolProviderManager } from './managers/tool-provider-manager';
export { SystemMessageManager } from './managers/system-message-manager';
export { FunctionCallManager } from './managers/function-call-manager';
export type { FunctionCallConfig, FunctionCallMode } from './managers/function-call-manager';

// 서비스들
export { ConversationService } from './services/conversation-service';

// 유틸리티
export { logger } from './utils';

// 기존 기능들 (하위 호환성)
export * from './providers/openai-provider';

// function.ts에서 필요한 항목들
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