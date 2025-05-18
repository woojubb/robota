/**
 * @module @robota-sdk/tools
 * 
 * Robota AI 에이전트를 위한 도구 라이브러리
 */

/**
 * 도구 실행 결과 타입
 */
export interface ToolResult<T = any> {
    /**
     * 도구 실행 성공 여부
     */
    success: boolean;

    /**
     * 도구 실행 결과 데이터
     */
    data?: T;

    /**
     * 도구 실행 중 발생한 오류
     */
    error?: string;

    /**
     * 추가 메타데이터
     */
    metadata?: Record<string, any>;
}

/**
 * 도구 파라미터 타입
 */
export interface ToolParameter {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    description?: string;
    required?: boolean;
    defaultValue?: any;
}

/**
 * 도구 인터페이스
 */
export interface Tool<TInput = any, TOutput = any> {
    /**
     * 도구 이름
     */
    name: string;

    /**
     * 도구 설명
     */
    description?: string;

    /**
     * 도구 파라미터 정의
     */
    parameters?: ToolParameter[];

    /**
     * 도구 실행 함수
     * 
     * @param input - 도구 입력 파라미터
     * @returns 실행 결과
     */
    execute: (input: TInput) => Promise<ToolResult<TOutput>>;
}

/**
 * 도구 생성 옵션
 */
export interface CreateToolOptions<TInput = any, TOutput = any> {
    /**
     * 도구 이름
     */
    name: string;

    /**
     * 도구 설명
     */
    description?: string;

    /**
     * 도구 파라미터 정의
     */
    parameters?: ToolParameter[];

    /**
     * 도구 실행 함수
     */
    execute: (input: TInput) => Promise<TOutput | ToolResult<TOutput>>;
}

/**
 * 도구 생성 함수
 * 
 * @param options - 도구 생성 옵션
 * @returns 생성된 도구
 * 
 * @example
 * ```ts
 * const weatherTool = createTool({
 *   name: 'getWeather',
 *   description: '특정 위치의 날씨 정보를 가져옵니다',
 *   parameters: [
 *     { name: 'location', type: 'string', description: '위치 (도시명)', required: true }
 *   ],
 *   execute: async ({ location }) => {
 *     // 날씨 API 호출 로직
 *     return { temperature: 25, humidity: 60, conditions: '맑음' };
 *   }
 * });
 * ```
 */
export function createTool<TInput = any, TOutput = any>(
    options: CreateToolOptions<TInput, TOutput>
): Tool<TInput, TOutput> {
    return {
        name: options.name,
        description: options.description,
        parameters: options.parameters,
        execute: async (input: TInput) => {
            try {
                const result = await options.execute(input);

                // 이미 ToolResult 형식이면 그대로 반환
                if (result && typeof result === 'object' && 'success' in result) {
                    return result as ToolResult<TOutput>;
                }

                // 일반 결과를 ToolResult로 래핑
                return {
                    success: true,
                    data: result
                };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        }
    };
}

/**
 * 도구 레지스트리 클래스
 * 
 * 여러 도구를 등록하고 관리하는 클래스
 */
export class ToolRegistry {
    private tools: Map<string, Tool> = new Map();

    /**
     * 도구 등록
     * 
     * @param tool - 등록할 도구
     */
    register(tool: Tool): ToolRegistry {
        this.tools.set(tool.name, tool);
        return this;
    }

    /**
     * 여러 도구 등록
     * 
     * @param tools - 등록할 도구 배열
     */
    registerMany(tools: Tool[]): ToolRegistry {
        for (const tool of tools) {
            this.register(tool);
        }
        return this;
    }

    /**
     * 도구 가져오기
     * 
     * @param name - 가져올 도구 이름
     * @returns 도구 또는 undefined
     */
    getTool(name: string): Tool | undefined {
        return this.tools.get(name);
    }

    /**
     * 모든 도구 가져오기
     * 
     * @returns 모든 등록된 도구 배열
     */
    getAllTools(): Tool[] {
        return Array.from(this.tools.values());
    }

    /**
     * 도구 실행
     * 
     * @param name - 실행할 도구 이름
     * @param input - 도구 입력 파라미터
     * @returns 도구 실행 결과
     */
    async executeTool<TInput = any, TOutput = any>(
        name: string,
        input: TInput
    ): Promise<ToolResult<TOutput>> {
        const tool = this.getTool(name) as Tool<TInput, TOutput>;

        if (!tool) {
            return {
                success: false,
                error: `도구 '${name}'을(를) 찾을 수 없습니다`
            };
        }

        try {
            return await tool.execute(input);
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
}

// Zod 관련 기능 내보내기
export {
    zodToJsonSchema,
    zodFunctionToSchema,
    type ZodFunctionTool
} from './zod-schema';

export {
    createZodFunctionToolProvider,
    type ZodFunctionToolProviderOptions
} from './function-tool-provider'; 