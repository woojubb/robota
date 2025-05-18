import type {
  Context,
  FunctionDefinition,
  Message,
  ModelResponse,
  ProviderOptions,
  StreamingResponseChunk,
  FunctionSchema
} from './types';

/**
 * 모델 컨텍스트 프로토콜(MCP)
 * 
 * 다양한 AI 모델 제공업체와 통합하기 위한 표준화된 인터페이스
 */
export interface ModelContextProtocol {
  /**
   * 기본 모델 및 설정
   */
  options: ProviderOptions;

  /**
   * 주어진 컨텍스트로 모델에 요청을 보내고 응답을 받습니다.
   * 
   * @param context 요청 컨텍스트 (메시지, 함수 정의 등)
   * @param options 추가 옵션
   * @returns 모델 응답
   */
  chat(context: Context, options?: {
    temperature?: number;
    maxTokens?: number;
    functionCallMode?: 'auto' | 'force' | 'disabled';
    forcedFunction?: string;
    forcedArguments?: Record<string, any>;
  }): Promise<ModelResponse>;

  /**
   * 주어진 컨텍스트로 모델에 스트리밍 요청을 보내고 응답 청크를 받습니다.
   * 
   * @param context 요청 컨텍스트 (메시지, 함수 정의 등)
   * @param options 추가 옵션
   * @returns 스트리밍 응답 AsyncIterable
   */
  chatStream(context: Context, options?: {
    temperature?: number;
    maxTokens?: number;
    functionCallMode?: 'auto' | 'force' | 'disabled';
    forcedFunction?: string;
    forcedArguments?: Record<string, any>;
  }): AsyncIterable<StreamingResponseChunk>;

  /**
   * 메시지를 모델이 이해할 수 있는 형식으로 포맷합니다.
   * 
   * @param messages 메시지 배열
   * @returns 포맷된 메시지
   */
  formatMessages(messages: Message[]): any;

  /**
   * 함수 정의를 모델이 이해할 수 있는 형식으로 포맷합니다.
   * 
   * @param functions 함수 정의 배열
   * @returns 포맷된 함수 정의
   */
  formatFunctions(functions: FunctionSchema[]): any;

  /**
   * 모델 응답을 표준 형식으로 파싱합니다.
   * 
   * @param response 모델의 원시 응답
   * @returns 표준화된 ModelResponse
   */
  parseResponse(response: any): ModelResponse;

  /**
   * 스트리밍 응답 청크를 표준 형식으로 파싱합니다.
   * 
   * @param chunk 모델의 원시 응답 청크
   * @returns 표준화된 StreamingResponseChunk
   */
  parseStreamingChunk(chunk: any): StreamingResponseChunk;

  /**
   * 모델의 토큰 사용량을 계산합니다.
   * 
   * @param input 입력 텍스트
   * @returns 추정 토큰 수
   */
  countTokens?(input: string): Promise<number>;
} 