import type { AgentConfig } from '../interfaces/agent';

/**
 * Validation result interface
 */
export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings?: string[];
}

/**
 * Validation utility class
 */
export class Validator {
    /**
     * Validate agent configuration
     */
    static validateAgentConfig(config: Partial<AgentConfig>): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Required fields validation
        if (!config.model) {
            errors.push('model is required');
        }

        if (!config.provider) {
            errors.push('provider is required');
        }

        // Legacy support
        if (!config.model && config.currentModel) {
            config.model = config.currentModel;
        }

        if (!config.provider && config.currentProvider) {
            config.provider = config.currentProvider;
        }

        // Legacy aiProviders validation
        if (config.aiProviders && config.currentProvider) {
            if (!config.aiProviders[config.currentProvider]) {
                errors.push(`currentProvider "${config.currentProvider}" is not found in aiProviders`);
            }
        }

        // Optional field validation
        if (config.temperature !== undefined) {
            if (typeof config.temperature !== 'number' || config.temperature < 0 || config.temperature > 2) {
                errors.push('temperature must be a number between 0 and 2');
            }
        }

        if (config.maxTokens !== undefined) {
            if (typeof config.maxTokens !== 'number' || config.maxTokens <= 0) {
                errors.push('maxTokens must be a positive number');
            }
        }

        // Warnings for best practices
        if (config.systemMessage && config.systemMessage.length > 1000) {
            warnings.push('systemMessage is quite long, consider keeping it concise for better performance');
        }

        if (config.tools && config.tools.length > 20) {
            warnings.push('Large number of tools may impact performance, consider grouping related tools');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate user input string
     */
    static validateUserInput(input: string): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!input || typeof input !== 'string') {
            errors.push('Input must be a non-empty string');
        } else {
            if (input.trim().length === 0) {
                errors.push('Input cannot be only whitespace');
            }

            if (input.length > 10000) {
                warnings.push('Very long input may be truncated by AI providers');
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate provider name
     */
    static validateProviderName(name: string): ValidationResult {
        const errors: string[] = [];

        if (!name || typeof name !== 'string') {
            errors.push('Provider name must be a non-empty string');
        } else {
            if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
                errors.push('Provider name must start with a letter and contain only letters, numbers, underscores, and hyphens');
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Validate model name
     */
    static validateModelName(name: string): ValidationResult {
        const errors: string[] = [];

        if (!name || typeof name !== 'string') {
            errors.push('Model name must be a non-empty string');
        } else {
            if (name.trim().length === 0) {
                errors.push('Model name cannot be only whitespace');
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Validate API key format (basic check)
     */
    static validateApiKey(apiKey: string, provider?: string): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!apiKey || typeof apiKey !== 'string') {
            errors.push('API key must be a non-empty string');
            return { isValid: false, errors };
        }

        // Basic format checks based on provider
        switch (provider?.toLowerCase()) {
            case 'openai':
                if (!apiKey.startsWith('sk-')) {
                    warnings.push('OpenAI API keys typically start with "sk-"');
                }
                break;
            case 'anthropic':
                if (!apiKey.startsWith('sk-ant-')) {
                    warnings.push('Anthropic API keys typically start with "sk-ant-"');
                }
                break;
        }

        // General security checks
        if (apiKey.length < 10) {
            errors.push('API key appears to be too short');
        }

        if (/\s/.test(apiKey)) {
            errors.push('API key should not contain whitespace');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }
}

// Standalone validation functions for convenience
export const validateAgentConfig = Validator.validateAgentConfig;
export const validateUserInput = Validator.validateUserInput;
export const validateProviderName = Validator.validateProviderName;
export const validateModelName = Validator.validateModelName;
export const validateApiKey = Validator.validateApiKey; 