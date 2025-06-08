import { BaseToolProvider, type ToolProvider } from './tool-provider';
import type { FunctionSchema } from './types';

/**
 * MCP client interface
 * Compatible with Client from @modelcontextprotocol/sdk
 */
export interface MCPClient {
    // Essential methods of MCP client
    chat: (options: any) => Promise<any>;
    stream: (options: any) => AsyncIterable<any>;
    // Tool call method
    callTool: (toolName: string, parameters: Record<string, any>) => Promise<any>;
    // Tool listing method (선택적)
    listTools?: () => Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: any }> }>;
    // Additional methods...
}

/**
 * MCP 도구 제공자 옵션
 */
export interface MCPToolProviderOptions {
    /** MCP 클라이언트 인스턴스 */
    mcpClient: MCPClient;
    /** 로거 함수 (선택사항) */
    logger?: (message: string, context?: Record<string, any>) => void;
}

/**
 * MCP(Model Context Protocol) 기반 도구 제공자 클래스
 */
export class MCPToolProvider extends BaseToolProvider {
    private readonly mcpClient: MCPClient;
    public functions?: FunctionSchema[];

    constructor(options: MCPToolProviderOptions) {
        super({ logger: options.logger });
        this.mcpClient = options.mcpClient;
        this.initializeFunctions();
    }

    /**
     * MCP 클라이언트에서 도구 목록을 가져와 함수 스키마로 변환
     */
    private async initializeFunctions(): Promise<void> {
        try {
            if (this.mcpClient.listTools) {
                const result = await this.mcpClient.listTools();
                this.functions = result.tools.map(tool => ({
                    name: tool.name,
                    description: tool.description || `MCP 도구: ${tool.name}`,
                    parameters: tool.inputSchema || {
                        type: 'object',
                        properties: {},
                        required: []
                    }
                }));
            }
        } catch (error) {
            this.logError('MCP 도구 목록 초기화 실패', { error });
            // 실패해도 계속 진행 (함수 목록 없이도 동작 가능)
            this.functions = [];
        }
    }

    /**
     * 도구 호출 구현
     */
    async callTool(toolName: string, parameters: Record<string, any>): Promise<any> {
        return this.executeToolSafely(toolName, parameters, async () => {
            // MCP 클라이언트를 통해 도구 호출
            return await this.mcpClient.callTool(toolName, parameters);
        });
    }

    /**
     * 사용 가능한 도구 목록 반환 (오버라이드)
     * MCP의 경우 함수 목록이 없을 수도 있으므로 동적으로 처리
     */
    getAvailableTools(): string[] {
        if (!this.functions || this.functions.length === 0) {
            // 함수 목록이 없는 경우 빈 배열 반환
            // MCP 클라이언트가 동적으로 도구를 제공할 수 있음
            return [];
        }
        return super.getAvailableTools();
    }

    /**
     * 특정 도구가 존재하는지 확인 (오버라이드)
     * MCP의 경우 함수 목록이 없어도 도구가 존재할 수 있으므로 항상 true 반환
     */
    hasTool(toolName: string): boolean {
        if (!this.functions || this.functions.length === 0) {
            // 함수 목록이 없는 경우 MCP 클라이언트가 동적으로 처리할 수 있다고 가정
            return true;
        }
        return super.hasTool(toolName);
    }
}

/**
 * MCP(Model Context Protocol) 기반 도구 제공자 생성 함수
 * 
 * @param mcpClient MCP 클라이언트 인스턴스
 * @returns MCP 기반 도구 제공자 객체
 */
export function createMcpToolProvider(mcpClient: MCPClient): ToolProvider {
    return new MCPToolProvider({ mcpClient });
} 