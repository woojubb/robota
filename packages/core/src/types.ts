// ToolProvider 가져오기 
import type { ToolProvider } from '@robota-sdk/tools';
// FunctionSchema는 내부에서 직접 정의

/**
 * 함수 스키마 인터페이스
 */
export interface FunctionSchema {
    name: string;
    description?: string;
    parameters: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description?: string;
            enum?: any[];
            default?: any;
        }>;
        required?: string[];
    };
}

/**
 * 함수 호출 결과 인터페이스
 */
export interface FunctionCallResult {
    name: string;
    result?: any;
    error?: string;
}

/**
 * 함수 정의 인터페이스
 */
export interface FunctionDefinition {
    name: string;
    description?: string;
    parameters?: {
        type: string;
        properties?: Record<string, {
            type: string;
            description?: string;
            enum?: any[];
            default?: any;
        }>;
        required?: string[];
    };
}

/**
 * 제공업체 옵션 인터페이스
 */
export interface ProviderOptions {
    model: string;
    temperature?: number;
    maxTokens?: number;
    stopSequences?: string[];
    streamMode?: boolean;
}

/**
 * 실행 옵션 인터페이스
 */
export interface RunOptions {
    systemPrompt?: string;
    functionCallMode?: string; // 'auto' | 'force' | 'disabled'
    forcedFunction?: string;
    forcedArguments?: Record<string, any>;
    temperature?: number;
    maxTokens?: number;
} 