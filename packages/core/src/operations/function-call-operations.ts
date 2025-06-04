import type { FunctionCallManager, FunctionCallMode } from '../managers/function-call-manager';
import type { ToolProviderManager } from '../managers/tool-provider-manager';
import type { RunOptions } from '../types';

/**
 * 함수 호출 관련 순수 함수들
 * Robota 클래스의 함수 호출 관련 로직을 순수 함수로 분리
 */

/**
 * 함수 호출 모드를 설정하는 순수 함수
 */
export function setFunctionCallMode(
    mode: FunctionCallMode,
    functionCallManager: FunctionCallManager
): void {
    functionCallManager.setFunctionCallMode(mode);
}

/**
 * 함수 호출 설정을 종합적으로 구성하는 순수 함수
 */
export function configureFunctionCall(
    config: {
        mode?: FunctionCallMode;
        maxCalls?: number;
        timeout?: number;
        allowedFunctions?: string[];
    },
    functionCallManager: FunctionCallManager,
    toolProviderManager: ToolProviderManager
): void {
    functionCallManager.configure(config);

    // Sync with tool provider manager
    if (config.allowedFunctions) {
        toolProviderManager.setAllowedFunctions(config.allowedFunctions);
    }
}

/**
 * 기본 함수 호출 모드를 적용하는 순수 함수
 */
export function applyDefaultFunctionCallMode(
    options: RunOptions,
    functionCallManager: FunctionCallManager
): RunOptions {
    return {
        ...options,
        functionCallMode: options.functionCallMode ?? functionCallManager.getDefaultMode()
    };
} 