import { ToolProvider } from './tool-provider';

/**
 * MCP 클라이언트 인터페이스
 * @modelcontextprotocol/sdk의 Client와 호환됩니다
 */
export interface MCPClient {
    // MCP 클라이언트의 필수 메서드들
    chat: (options: any) => Promise<any>;
    stream: (options: any) => AsyncIterable<any>;
    // 도구 호출 메서드
    callTool: (toolName: string, parameters: Record<string, any>) => Promise<any>;
    // 추가 메서드들...
}

/**
 * MCP(Model Context Protocol) 기반 도구 제공자 생성 함수
 * 
 * @param mcpClient MCP 클라이언트 인스턴스
 * @returns MCP 기반 도구 제공자 객체
 */
export function createMcpToolProvider(mcpClient: MCPClient): ToolProvider {
    return {
        async callTool(toolName: string, parameters: Record<string, any>) {
            try {
                // MCP 클라이언트를 통해 도구 호출
                const result = await mcpClient.callTool(toolName, parameters);
                return result;
            } catch (error) {
                console.error(`도구 '${toolName}' 호출 중 오류:`, error);
                throw new Error(`도구 호출 실패: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    };
} 