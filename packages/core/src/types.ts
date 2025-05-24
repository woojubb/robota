// Import ToolProvider 
import type { ToolProvider } from '@robota-sdk/tools';
// FunctionSchema is defined directly internally

/**
 * Function schema interface
 */
export interface FunctionSchema {
    name: string;
    description?: string;
    parameters: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description?: string;
            enum?: any[];
            default?: any;
        }>;
        required?: string[];
    };
}

/**
 * Function call result interface
 */
export interface FunctionCallResult {
    name: string;
    result?: any;
    error?: string;
}

/**
 * Function definition interface
 */
export interface FunctionDefinition {
    name: string;
    description?: string;
    parameters?: {
        type: string;
        properties?: Record<string, {
            type: string;
            description?: string;
            enum?: any[];
            default?: any;
        }>;
        required?: string[];
    };
}

/**
 * Provider options interface
 */
export interface ProviderOptions {
    model: string;
    temperature?: number;
    maxTokens?: number;
    stopSequences?: string[];
    streamMode?: boolean;
}

/**
 * Run options interface
 */
export interface RunOptions {
    systemPrompt?: string;
    functionCallMode?: string; // 'auto' | 'force' | 'disabled'
    forcedFunction?: string;
    forcedArguments?: Record<string, any>;
    temperature?: number;
    maxTokens?: number;
} 