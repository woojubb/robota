import type { FunctionCallManager, FunctionCallMode } from '../managers/function-call-manager';
import type { ToolProviderManager } from '../managers/tool-provider-manager';
import type { RunOptions } from '../types';

/**
 * Function call related pure functions
 * Separated function call related logic from Robota class into pure functions
 */

/**
 * Pure function to set function call mode
 */
export function setFunctionCallMode(
    mode: FunctionCallMode,
    functionCallManager: FunctionCallManager
): void {
    functionCallManager.setFunctionCallMode(mode);
}

/**
 * Pure function to comprehensively configure function call settings
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
 * Pure function to apply default function call mode
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