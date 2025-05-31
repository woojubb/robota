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
    forcedArguments?: Record<string, unknown>;
    temperature?: number;
    maxTokens?: number;
} 