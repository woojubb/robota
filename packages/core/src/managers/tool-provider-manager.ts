import type { ToolProvider } from '../tool-provider';
import type { FunctionSchema } from '../types';
import type { Logger } from '../interfaces/logger';

/**
 * 도구 제공자 관리 클래스
 * Tool Provider들의 등록, 도구 호출, 조회를 담당합니다.
 */
export class ToolProviderManager {
    private toolProviders: ToolProvider[] = [];
    private allowedFunctions?: string[];
    private logger: Logger;

    constructor(logger: Logger, allowedFunctions?: string[]) {
        this.logger = logger;
        this.allowedFunctions = allowedFunctions;
    }

    /**
     * Tool Provider 추가
     * 
     * @param toolProvider - 도구 제공자 인스턴스
     */
    addProvider(toolProvider: ToolProvider): void {
        this.toolProviders.push(toolProvider);
    }

    /**
     * 여러 Tool Provider들 추가
     * 
     * @param toolProviders - 도구 제공자 배열
     */
    addProviders(toolProviders: ToolProvider[]): void {
        this.toolProviders.push(...toolProviders);
    }

    /**
     * 허용된 함수 목록 설정
     * 
     * @param allowedFunctions - 허용된 함수명 배열
     */
    setAllowedFunctions(allowedFunctions?: string[]): void {
        this.allowedFunctions = allowedFunctions;
    }

    /**
     * 도구 호출
     * 
     * @param toolName - 호출할 도구 이름
     * @param parameters - 도구에 전달할 파라미터
     * @returns 도구 호출 결과
     */
    async callTool(toolName: string, parameters: Record<string, any>): Promise<any> {
        if (this.toolProviders.length === 0) {
            throw new Error('도구 제공자(toolProviders)가 설정되지 않았습니다.');
        }

        // 도구 호출 전 파라미터 검증
        if (this.allowedFunctions && !this.allowedFunctions.includes(toolName)) {
            throw new Error(`도구 '${toolName}'은(는) 허용되지 않습니다.`);
        }

        // 모든 toolProvider에서 해당 도구를 찾아서 호출
        for (const toolProvider of this.toolProviders) {
            if (toolProvider.functions?.some(fn => fn.name === toolName)) {
                try {
                    const result = await toolProvider.callTool(toolName, parameters);
                    return result;
                } catch (error) {
                    this.logger.error(`도구 '${toolName}' 호출 중 오류:`, error);
                    throw new Error(`도구 호출 실패: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }

        throw new Error(`도구 '${toolName}'을(를) 찾을 수 없습니다.`);
    }

    /**
     * 사용 가능한 도구 목록 반환
     * 
     * @returns 도구 스키마 목록
     */
    getAvailableTools(): FunctionSchema[] {
        return this.toolProviders.reduce((tools: FunctionSchema[], toolProvider) => {
            if (toolProvider.functions) {
                tools.push(...toolProvider.functions);
            }
            return tools;
        }, []);
    }

    /**
     * 등록된 Tool Provider 개수 반환
     */
    getProviderCount(): number {
        return this.toolProviders.length;
    }

    /**
     * Tool Provider가 등록되어 있는지 확인
     */
    hasProviders(): boolean {
        return this.toolProviders.length > 0;
    }

    /**
     * 특정 도구가 사용 가능한지 확인
     * 
     * @param toolName - 확인할 도구 이름
     */
    hasTool(toolName: string): boolean {
        return this.toolProviders.some(toolProvider =>
            toolProvider.functions?.some(fn => fn.name === toolName)
        );
    }
} 