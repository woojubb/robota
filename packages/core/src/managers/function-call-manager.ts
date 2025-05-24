/**
 * Function call mode
 */
export type FunctionCallMode = 'auto' | 'force' | 'disabled';

/**
 * Function call configuration interface
 */
export interface FunctionCallConfig {
    defaultMode?: FunctionCallMode;
    maxCalls?: number;
    timeout?: number;
    allowedFunctions?: string[];
}

/**
 * Function call management class
 * Manages function call settings and modes.
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
     * Set function call mode
     * 
     * @param mode - Function call mode ('auto', 'force', 'disabled')
     */
    setFunctionCallMode(mode: FunctionCallMode): void {
        this.config.defaultMode = mode;
    }

    /**
     * Configure function call settings
     * 
     * @param config - Function call configuration options
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
     * Get current function call mode
     */
    getDefaultMode(): FunctionCallMode {
        return this.config.defaultMode;
    }

    /**
     * Get maximum call count
     */
    getMaxCalls(): number {
        return this.config.maxCalls;
    }

    /**
     * Get timeout setting
     */
    getTimeout(): number {
        return this.config.timeout;
    }

    /**
     * Get allowed functions list
     */
    getAllowedFunctions(): string[] | undefined {
        return this.config.allowedFunctions;
    }

    /**
     * Get complete configuration
     */
    getConfig(): FunctionCallConfig {
        return { ...this.config };
    }

    /**
     * Check if a specific function is allowed
     * 
     * @param functionName - Function name to check
     */
    isFunctionAllowed(functionName: string): boolean {
        if (!this.config.allowedFunctions) {
            return true; // Allow all functions if no restrictions
        }
        return this.config.allowedFunctions.includes(functionName);
    }
} 