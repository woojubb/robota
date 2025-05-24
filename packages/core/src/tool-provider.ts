/**
 * @deprecated 이 파일은 호환성을 위해 유지됩니다. 
 * ToolProvider 인터페이스 및 관련 함수는 @robota-sdk/tools 패키지로 이동되었습니다.
 */

// ToolProvider 타입 정의
export interface ToolProvider {
    callTool(toolName: string, parameters: Record<string, any>): Promise<any>;
    functions?: any[];
} 