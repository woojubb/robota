/**
 * 메시지 역할 타입
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'function';

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
 * AI 제공업체 클라이언트 타입
 */
export type AIClientType = 'openai' | 'anthropic' | 'google' | 'cohere' | string;

/**
 * AI 제공업체 클라이언트 인터페이스
 */
export interface AIClient {
  type: AIClientType; // 클라이언트 타입
  instance: any; // 클라이언트 인스턴스
  close?: () => Promise<void>; // 클라이언트 연결 종료 메서드 (선택 사항)
  transport?: Transport; // 전송 계층 (선택 사항)
}

/**
 * 전송 계층 인터페이스
 */
export interface Transport {
  close: () => Promise<void>;
  // 필요시 추가 메서드
}

/**
 * Robota 설정 인터페이스
 */
export interface RobotaOptions {
  provider?: any; // 제공업체 인터페이스는 각 패키지에서 정의됨 (선택 사항)
  aiClient?: AIClient; // AI 제공업체 클라이언트 (선택 사항)
  model?: string; // 사용할 모델명 (선택 사항)
  temperature?: number; // 모델 온도 (선택 사항)
  systemPrompt?: string;
  systemMessages?: Message[];
  memory?: any; // 메모리 인터페이스는 별도로 정의됨
  functionCallConfig?: FunctionCallConfig;
  onToolCall?: (toolName: string, params: any, result: any) => void; // 도구 호출 콜백
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