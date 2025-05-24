import type { FunctionCall } from '@robota-sdk/tools';
import type { UniversalMessage } from '../conversation-history';

/**
 * 메시지 역할 타입
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'function';

// Re-export FunctionCall from tools package
export type { FunctionCall };

/**
 * 기본 메시지 인터페이스
 */
export interface Message {
    role: MessageRole;
    content: string;
    name?: string;
    functionCall?: FunctionCall;
    functionResult?: any;
}

/**
 * 모델 응답 인터페이스
 */
export interface ModelResponse {
    content?: string;
    functionCall?: FunctionCall;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    metadata?: Record<string, any>;
}

/**
 * 스트리밍 응답 청크 인터페이스
 */
export interface StreamingResponseChunk {
    content?: string;
    functionCall?: Partial<FunctionCall>;
    isComplete?: boolean;
}

/**
 * 대화 컨텍스트 인터페이스
 */
export interface Context {
    messages: UniversalMessage[];
    systemPrompt?: string;
    systemMessages?: Message[];
    metadata?: Record<string, any>;
}

/**
 * AI 제공업체 인터페이스 (통합 래퍼)
 */
export interface AIProvider {
    /** 제공업체 이름 */
    name: string;

    /** 채팅 요청 */
    chat(model: string, context: Context, options?: any): Promise<ModelResponse>;

    /** 스트리밍 채팅 요청 (선택 사항) */
    chatStream?(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown>;

    /** 리소스 해제 (선택 사항) */
    close?(): Promise<void>;
} 