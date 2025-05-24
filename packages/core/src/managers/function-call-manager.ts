/**
 * 함수 호출 모드
 */
export type FunctionCallMode = 'auto' | 'force' | 'disabled';

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
 * 함수 호출 관리 클래스
 * 함수 호출 설정과 모드를 관리합니다.
 */
export class FunctionCallManager {
    private config: {
        defaultMode: FunctionCallMode;
        maxCalls: number;
        timeout: number;
        allowedFunctions?: string[];
    };

    constructor(initialConfig?: FunctionCallConfig) {
        this.config = {
            defaultMode: initialConfig?.defaultMode || 'auto',
            maxCalls: initialConfig?.maxCalls || 10,
            timeout: initialConfig?.timeout || 30000,
            allowedFunctions: initialConfig?.allowedFunctions
        };
    }

    /**
     * 함수 호출 모드 설정
     * 
     * @param mode - 함수 호출 모드 ('auto', 'force', 'disabled')
     */
    setFunctionCallMode(mode: FunctionCallMode): void {
        this.config.defaultMode = mode;
    }

    /**
     * 함수 호출 설정 구성
     * 
     * @param config - 함수 호출 구성 옵션
     */
    configure(config: {
        mode?: FunctionCallMode;
        maxCalls?: number;
        timeout?: number;
        allowedFunctions?: string[];
    }): void {
        if (config.mode) {
            this.config.defaultMode = config.mode;
        }
        if (config.maxCalls !== undefined) {
            this.config.maxCalls = config.maxCalls;
        }
        if (config.timeout !== undefined) {
            this.config.timeout = config.timeout;
        }
        if (config.allowedFunctions) {
            this.config.allowedFunctions = config.allowedFunctions;
        }
    }

    /**
     * 현재 함수 호출 모드 반환
     */
    getDefaultMode(): FunctionCallMode {
        return this.config.defaultMode;
    }

    /**
     * 최대 호출 횟수 반환
     */
    getMaxCalls(): number {
        return this.config.maxCalls;
    }

    /**
     * 타임아웃 설정 반환
     */
    getTimeout(): number {
        return this.config.timeout;
    }

    /**
     * 허용된 함수 목록 반환
     */
    getAllowedFunctions(): string[] | undefined {
        return this.config.allowedFunctions;
    }

    /**
     * 전체 설정 반환
     */
    getConfig(): FunctionCallConfig {
        return { ...this.config };
    }

    /**
     * 특정 함수가 허용되는지 확인
     * 
     * @param functionName - 확인할 함수명
     */
    isFunctionAllowed(functionName: string): boolean {
        if (!this.config.allowedFunctions) {
            return true; // 제한이 없으면 모든 함수 허용
        }
        return this.config.allowedFunctions.includes(functionName);
    }
} 