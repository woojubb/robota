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
 * Function call interface
 */
export interface FunctionCall {
    name: string;
    arguments: Record<string, any> | string;
}

/**
 * Function call result interface
 */
export interface FunctionCallResult {
    name: string;
    result?: any;
    error?: string;
}

export interface ToolParams {
    [key: string]: any;
}

export interface ToolResult<T = any> {
    success: boolean;
    data?: T;
    error?: string;
} 