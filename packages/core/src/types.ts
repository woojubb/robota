/**
 * 메시지 역할 타입
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'function';

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
 * 함수 호출 인터페이스
 */
export interface FunctionCall {
  name: string;
  arguments: Record<string, any> | string;
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
 * 함수 호출 모드
 */
export type FunctionCallMode = 'auto' | 'force' | 'disabled';

/**
 * 실행 옵션 인터페이스
 */
export interface RunOptions {
  systemPrompt?: string;
  functionCallMode?: FunctionCallMode;
  forcedFunction?: string;
  forcedArguments?: Record<string, any>;
  temperature?: number;
  maxTokens?: number;
}

/**
 * 함수 호출 설정 인터페이스
 */
export interface FunctionCallConfig {
  defaultMode?: FunctionCallMode;
  maxCalls?: number;
  timeout?: number;
  allowedFunctions?: string[];
}

/**
 * 대화 컨텍스트 인터페이스
 */
export interface Context {
  messages: Message[];
  systemPrompt?: string;
  systemMessages?: Message[];
  metadata?: Record<string, any>;
}