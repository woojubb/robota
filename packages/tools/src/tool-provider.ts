import type { FunctionSchema } from '@robota-sdk/core';

/**
 * 도구 제공자(Tool Provider) 인터페이스
 * 
 * 다양한 도구 제공자(MCP, OpenAPI, ZodFunction 등)에 대한 통일된 인터페이스
 * 도구 제공자는 AI 모델이 도구를 호출할 수 있도록 하는 역할을 합니다.
 */
export interface ToolProvider {
    /**
     * 도구를 호출합니다. 모든 도구 제공자는 이 인터페이스를 구현해야 합니다.
     * 
     * @param toolName 호출할 도구 이름
     * @param parameters 도구에 전달할 파라미터
     * @returns 도구 호출 결과
     */
    callTool(toolName: string, parameters: Record<string, any>): Promise<any>;

    /**
     * 도구 제공자가 제공하는 모든 함수 스키마 목록
     * AI 모델에 도구 목록을 전달할 때 사용됩니다.
     */
    functions?: FunctionSchema[];
} 